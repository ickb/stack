#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [testnet|mainnet|all]\n' "${0##*/}" >&2
  printf '       %s --migrate <testnet|mainnet>\n' "${0##*/}" >&2
  printf 'Fresh installs publish the invoking clean checkout HEAD; --migrate converts a proven legacy checkout in place.\n' >&2
}

script_root() {
  local script_dir
  script_dir=$(dirname "${BASH_SOURCE[0]}")
  realpath "${script_dir}/.."
}

deployment_root() {
  printf '/opt/ickb-stack-%s\n' "$1"
}

require_node_22_19() {
  local node_bin=$1
  local context=$2
  "${node_bin}" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)' || {
    printf 'Node.js >=22.19.0 is required %s. Found: %s\n' "${context}" "$("${node_bin}" --version)" >&2
    exit 1
  }
}

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    printf 'Run this script as root, for example with sudo.\n' >&2
    exit 1
  fi
}

require_runtime() {
  if [[ ! -x /usr/bin/node ]]; then
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there before installing units.\n' >&2
    exit 1
  fi
  require_node_22_19 /usr/bin/node "at /usr/bin/node"
  command -v node >/dev/null || {
    printf 'node is required before installing units.\n' >&2
    exit 1
  }
  require_node_22_19 "$(command -v node)" "on PATH"
  command -v pnpm >/dev/null || {
    printf 'pnpm is required before installing units.\n' >&2
    exit 1
  }
  command -v git >/dev/null || {
    printf 'git is required before installing units.\n' >&2
    exit 1
  }
  command -v flock >/dev/null || {
    printf 'flock is required before installing units.\n' >&2
    exit 1
  }
}

safe_install_directory() {
  local path=$1
  local mode=$2
  local uid=$3
  local gid=$4
  node - "${path}" "${mode}" "${uid}" "${gid}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const target = process.argv[2];
const mode = Number.parseInt(process.argv[3], 8);
const uid = Number(process.argv[4]);
const gid = Number(process.argv[5]);
if (!path.isAbsolute(target) || !Number.isInteger(mode) || !Number.isInteger(uid) || !Number.isInteger(gid)) fail("Invalid directory install arguments");
const parsed = path.parse(target);
let current = parsed.root;
assertDirectory(current);
for (const part of path.relative(parsed.root, target).split(path.sep).filter(Boolean)) {
  current = path.join(current, part);
  try {
    assertDirectory(current);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    fs.mkdirSync(current, { mode });
    assertDirectory(current);
  }
}
fs.chmodSync(target, mode);
fs.chownSync(target, uid, gid);

function assertDirectory(candidate) {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) fail(`Refusing symlinked directory path: ${candidate}`);
  if (!stat.isDirectory()) fail(`Directory path is not a directory: ${candidate}`);
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
NODE
}

service_user_home() {
  local user=$1
  local passwd_entry
  local user_home
  passwd_entry=$(getent passwd "${user}") || return 1
  IFS=: read -r _ _ _ _ _ user_home _ <<<"${passwd_entry}"
  [[ -n ${user_home} ]] || return 1
  printf '%s\n' "${user_home}"
}

run_as_service_user() {
  local user=$1
  local user_home=$2
  shift 2
  runuser -u "${user}" -- env HOME="${user_home}" USER="${user}" LOGNAME="${user}" SHELL=/bin/bash "$@"
}

render_unit() {
  local network=$1
  local deploy_dir=$2
  local user="ickb-bot-${network}"
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"
  local log_root_path="${deploy_dir}/log"

  cat <<UNIT
[Unit]
Description=iCKB bot ${network}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${deploy_dir}/current
Environment=BOT_CONFIG_FILE=%d/${credential_name}
LoadCredentialEncrypted=${credential_name}:${credential}
ExecStart=/usr/bin/node scripts/bot/launcher.ts --log-root ${log_root_path} --no-child-tee
Restart=on-failure
RestartSec=60
RestartPreventExitStatus=2
LimitCORE=0
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ReadWritePaths=${log_root_path}
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
}

install_unit() {
  local network=$1
  local deploy_dir=$2
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local pending="${unit_path}.new"
  render_unit "${network}" "${deploy_dir}" >"${pending}"
  chmod 644 "${pending}"
  mv -f "${pending}" "${unit_path}"
}

require_clean_checkout() {
  local user=$1
  local user_home=$2
  local checkout=$3
  run_as_service_user "${user}" "${user_home}" git -C "${checkout}" rev-parse --is-inside-work-tree >/dev/null
  if [[ -n $(run_as_service_user "${user}" "${user_home}" git -C "${checkout}" status --porcelain --untracked-files=all) ]]; then
    printf 'Checkout %s has local changes or untracked files; refusing deployment.\n' "${checkout}" >&2
    return 1
  fi
  run_as_service_user "${user}" "${user_home}" git -C "${checkout}" diff --check
}

require_clean_source_checkout() {
  local source=$1
  git -c safe.directory="${source}" -C "${source}" rev-parse --is-inside-work-tree >/dev/null
  if [[ -n $(git -c safe.directory="${source}" -C "${source}" status --porcelain --untracked-files=all) ]]; then
    printf 'Install source %s has local changes or untracked files; refusing deployment.\n' "${source}" >&2
    return 1
  fi
  git -c safe.directory="${source}" -C "${source}" diff --check
}

prepare_checkout_copy() {
  local user=$1
  local user_home=$2
  local source=$3
  local target=$4
  local pnpm_bin=$5
  if [[ ! -e ${target} && ! -L ${target} ]]; then
    run_as_service_user "${user}" "${user_home}" mkdir "${target}"
  fi
  [[ -d ${target} && ! -L ${target} && -z $(ls -A "${target}") ]] || {
    printf 'Checkout staging directory is not an empty real directory: %s\n' "${target}" >&2
    return 1
  }
  cp -R "${source}/.git" "${target}/.git"
  chown -R "${user}:${user}" "${target}/.git"
  prepare_git_checkout "${user}" "${user_home}" "${target}" "${pnpm_bin}"
}

prepare_git_checkout() {
  local user=$1
  local user_home=$2
  local target=$3
  local pnpm_bin=$4
  run_as_service_user "${user}" "${user_home}" git -C "${target}" reset --hard HEAD
  run_as_service_user "${user}" "${user_home}" git -C "${target}" clean -ffd
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${target}" bot:install
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${target}" bot:check
  require_clean_checkout "${user}" "${user_home}" "${target}"
}

release_id() {
  local checkout=$1
  local prefix=$2
  local commit
  commit=$(git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --verify HEAD)
  [[ ${commit} =~ ^[0-9a-f]{40,64}$ ]] || return 1
  printf '%s%s-%s\n' "${prefix}" "$(date -u +%Y%m%dT%H%M%S%N)" "${commit:0:12}"
}

freeze_release() {
  local release=$1
  chown -R root:root "${release}"
  chmod -R a-w "${release}"
}

require_release_layout() {
  local deploy_dir=$1
  node - "${deploy_dir}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
for (const candidate of [root, path.join(root, "releases"), path.join(root, "log"), path.join(root, "log", "bot")]) assertRealDirectory(candidate);
const current = path.join(root, "current");
if (!fs.lstatSync(current).isSymbolicLink()) fail(`${current} must be a symbolic link`);
const target = fs.readlinkSync(current);
if (!/^releases\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target)) fail(`${current} must point directly to a named release`);
assertRealDirectory(path.join(root, target));
assertRealDirectory(path.join(root, target, ".git"));

function assertRealDirectory(candidate) {
  const parsed = path.parse(candidate);
  let part = parsed.root;
  for (const name of path.relative(parsed.root, candidate).split(path.sep).filter(Boolean)) {
    part = path.join(part, name);
    const stat = fs.lstatSync(part);
    if (stat.isSymbolicLink()) fail(`Refusing symlinked directory path: ${part}`);
    if (!stat.isDirectory()) fail(`Directory path is not a directory: ${part}`);
  }
}
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
NODE
}

bootstrap_network() {
  local deploy_dir=$1
  local user=$2
  local user_home=$3
  local user_id=$4
  local group_id=$5
  local source
  source=$(script_root)
  require_clean_source_checkout "${source}"

  safe_install_directory "${deploy_dir}" 755 0 0
  safe_install_directory "${deploy_dir}/releases" 755 "${user_id}" "${group_id}"
  safe_install_directory "${deploy_dir}/log" 755 0 0
  safe_install_directory "${deploy_dir}/log/bot" 700 "${user_id}" "${group_id}"
  local staging="${deploy_dir}/releases/.staging-${BASHPID}"
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  prepare_checkout_copy "${user}" "${user_home}" "${source}" "${staging}" "${pnpm_bin}"
  local id
  id=$(release_id "${staging}" "")
  local release="${deploy_dir}/releases/${id}"
  mv "${staging}" "${release}"
  freeze_release "${release}"
  ln -s "releases/${id}" "${deploy_dir}/current"
}

legacy_unit_is_compatible() {
  local unit_path=$1
  local network=$2
  local deploy_dir=$3
  local helper
  helper="$(script_root)/scripts/ickb-bot-systemd-update.sh"
  bash -c '
source "$1"
unit_text=$(<"$2")
credential_name="ickb-bot-$3-config.json"
credential="/etc/ickb/credentials/ickb-bot-$3-config.cred"
! unit_has_environment_name "${unit_text}" ICKB_BOT_LOG_ROOT &&
  unit_has_directive "${unit_text}" WorkingDirectory "$4" &&
  unit_has_directive "${unit_text}" Environment "BOT_CONFIG_FILE=%d/${credential_name}" &&
  unit_has_directive "${unit_text}" LoadCredentialEncrypted "${credential_name}:${credential}" &&
  unit_has_directive "${unit_text}" ExecStart "/usr/bin/node scripts/ickb-bot-launcher.mjs --network $3 -- /usr/bin/node apps/bot/dist/index.js" &&
  unit_has_directive "${unit_text}" RestartSec 10 &&
  unit_has_directive "${unit_text}" RestartPreventExitStatus 2 &&
  unit_has_directive "${unit_text}" LimitCORE 0 &&
  unit_has_directive "${unit_text}" NoNewPrivileges true &&
  unit_has_directive "${unit_text}" PrivateTmp true &&
  unit_has_directive "${unit_text}" ProtectProc invisible &&
  unit_has_directive "${unit_text}" ProtectSystem strict &&
  unit_has_directive "${unit_text}" ReadWritePaths "$4/log" &&
  unit_has_directive "${unit_text}" ProtectHome true
' bash "${helper}" "${unit_path}" "${network}" "${deploy_dir}"
}

require_legacy_layout() {
  local deploy_dir=$1
  local user_id=$2
  node - "${deploy_dir}" "${user_id}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const uid = Number(process.argv[3]);
for (const candidate of [root, path.join(root, ".git"), path.join(root, "log"), path.join(root, "log", "bot")]) {
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`Legacy path must be a real directory: ${candidate}`);
}
if (fs.lstatSync(root).uid !== uid) fail(`Legacy checkout must be owned by service UID ${uid}`);
for (const forbidden of [path.join(root, "current"), path.join(root, "releases")]) {
  if (fs.existsSync(forbidden) || isLink(forbidden)) fail(`Legacy checkout has ambiguous release-layout path: ${forbidden}`);
}
function isLink(candidate) {
  try { return fs.lstatSync(candidate).isSymbolicLink(); } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
NODE
}

wait_with_update_helper() {
  local service=$1
  local launches=$2
  local expected_release=$3
  local log_root=$4
  local network=$5
  local previous_run_id=${6:-}
  local helper
  helper="$(script_root)/scripts/ickb-bot-systemd-update.sh"
  bash -c 'source "$1"; wait_for_readiness "$2" "$3" "$4" "$5" "$6" "$7" 120' bash "${helper}" "${service}" "${launches}" "${expected_release}" "${log_root}" "${network}" "${previous_run_id}"
}

restore_legacy_migration() {
  local service=$1
  local unit_path=$2
  local unit_backup=$3
  local deploy_dir=$4
  local replacement=$5
  local holding=$6
  local old_id=$7

  systemctl stop "${service}" || {
    printf 'Migration recovery could not stop the candidate; no layout was moved.\n' >&2
    return 1
  }
  if [[ -d ${deploy_dir}/releases/${old_id} && ! -L ${deploy_dir}/releases/${old_id} ]]; then
    mv "${deploy_dir}/releases/${old_id}" "${holding}" || return 1
  fi
  if [[ -d ${deploy_dir}/log && -d ${holding} && ! -e ${holding}/log ]]; then
    mv "${deploy_dir}/log" "${holding}/log" || return 1
  fi
  if [[ -d ${deploy_dir} && ! -e ${replacement} ]]; then
    mv "${deploy_dir}" "${replacement}" || return 1
  fi
  if [[ -d ${holding} && ! -e ${deploy_dir} ]]; then
    mv "${holding}" "${deploy_dir}" || return 1
  fi
  install -m 644 "${unit_backup}" "${unit_path}" || return 1
  systemctl daemon-reload || return 1
  systemctl start "${service}" || return 1
  rm -rf -- "${replacement}" || return 1
  rm -f "${unit_backup}"
}

publish_migration() {
  local network=$1
  local deploy_dir=$2
  local replacement=$3
  local holding=$4
  local new_id=$5
  local old_id=$6
  local user=$7
  local user_id=$8
  local group_id=$9
  local service=${10}

  mv "${deploy_dir}" "${holding}" || return 1
  mv "${replacement}" "${deploy_dir}" || return 1
  mv "${holding}/log" "${deploy_dir}/log" || return 1
  mv "${holding}" "${deploy_dir}/releases/${old_id}" || return 1
  freeze_release "${deploy_dir}/releases/${new_id}" || return 1
  chown root:root "${deploy_dir}" || return 1
  chown "${user}:${user}" "${deploy_dir}/releases" || return 1
  chmod 755 "${deploy_dir}" "${deploy_dir}/releases" || return 1
  safe_install_directory "${deploy_dir}/log/bot" 700 "${user_id}" "${group_id}" || return 1
  install_unit "${network}" "${deploy_dir}" || return 1
  systemctl daemon-reload || return 1
  systemctl start "${service}" || return 1
  wait_with_update_helper \
    "${service}" \
    "${deploy_dir}/log/bot/launches.ndjson" \
    "${deploy_dir}/releases/${new_id}" \
    "${deploy_dir}/log" \
    "${network}"
}

migrate_network() {
  local network=$1
  local deploy_dir
  deploy_dir=$(deployment_root "${network}")
  local user="ickb-bot-${network}"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local user_id
  local group_id
  local user_home
  user_id=$(id -u "${user}")
  group_id=$(id -g "${user}")
  user_home=$(service_user_home "${user}")

  require_legacy_layout "${deploy_dir}" "${user_id}"
  require_clean_checkout "${user}" "${user_home}" "${deploy_dir}"
  legacy_unit_is_compatible "${unit_path}" "${network}" "${deploy_dir}" || {
    printf 'Legacy unit %s is not the shipped generated launcher unit; refusing migration.\n' "${unit_path}" >&2
    return 1
  }
  systemctl is-active --quiet "${service}" || {
    printf 'Legacy service %s must be active so migration and restoration can be proved.\n' "${service}" >&2
    return 1
  }

  local source
  source=$(script_root)
  require_clean_source_checkout "${source}"

  local parent=${deploy_dir%/*}
  local token
  token="$(date -u +%Y%m%dT%H%M%S%N)-${BASHPID}"
  local prepared="${parent}/.${deploy_dir##*/}.migration-release-${token}"
  local replacement="${parent}/.${deploy_dir##*/}.migration-root-${token}"
  local holding="${parent}/.${deploy_dir##*/}.legacy-${token}"
  local unit_backup="${unit_path}.migration-${token}"
  for path in "${prepared}" "${replacement}" "${holding}"; do
    [[ ! -e ${path} && ! -L ${path} ]] || {
      printf 'Migration staging path already exists: %s\n' "${path}" >&2
      return 1
    }
  done

  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  local new_id
  local old_id
  if ! install -d -m 700 -o "${user}" -g "${user}" "${prepared}" ||
     ! prepare_checkout_copy "${user}" "${user_home}" "${source}" "${prepared}" "${pnpm_bin}" ||
     ! new_id=$(release_id "${prepared}" "") ||
     ! old_id=$(release_id "${deploy_dir}" "legacy-") ||
     ! mkdir -m 755 "${replacement}" ||
     ! mkdir -m 755 "${replacement}/releases" ||
     ! mv "${prepared}" "${replacement}/releases/${new_id}" ||
     ! ln -s "releases/${new_id}" "${replacement}/current" ||
     ! install -m 644 "${unit_path}" "${unit_backup}"; then
    rm -rf -- "${prepared}" "${replacement}"
    rm -f "${unit_backup}"
    return 1
  fi

  if ! systemctl stop "${service}"; then
    rm -rf -- "${replacement}"
    rm -f "${unit_backup}"
    printf 'Legacy service stop failed; migration made no layout or unit changes.\n' >&2
    return 1
  fi
  if ! publish_migration \
    "${network}" "${deploy_dir}" "${replacement}" "${holding}" "${new_id}" "${old_id}" \
    "${user}" "${user_id}" "${group_id}" "${service}"; then
    printf 'Migration cutover failed; restoring the original legacy layout and unit.\n' >&2
    restore_legacy_migration \
      "${service}" "${unit_path}" "${unit_backup}" "${deploy_dir}" "${replacement}" "${holding}" "${old_id}" || {
      printf 'Legacy restoration failed; immediate operator intervention is required.\n' >&2
      return 1
    }
    return 1
  fi
  rm -rf -- "${deploy_dir}/releases/${old_id}"
  rm -f "${unit_backup}"
  printf 'Migrated %s from the invoking validated checkout without copying or deleting log data.\n' "${network}"
}

install_network() {
  local network=$1
  local deploy_dir
  deploy_dir=$(deployment_root "${network}")
  local user="ickb-bot-${network}"
  local service="ickb-bot-${network}.service"
  if ! id -u "${user}" >/dev/null 2>&1; then
    useradd --system --create-home --user-group --shell /usr/sbin/nologin "${user}"
  fi
  local user_id
  local group_id
  local user_home
  user_id=$(id -u "${user}")
  group_id=$(id -g "${user}")
  user_home=$(service_user_home "${user}")

  if [[ ! -e ${deploy_dir} && ! -L ${deploy_dir} ]]; then
    bootstrap_network "${deploy_dir}" "${user}" "${user_home}" "${user_id}" "${group_id}"
  elif [[ -d ${deploy_dir}/.git && ! -L ${deploy_dir}/.git ]]; then
    printf '%s is a legacy checkout. Re-run with --migrate %s; no files were changed.\n' "${deploy_dir}" "${network}" >&2
    return 1
  else
    require_release_layout "${deploy_dir}"
  fi

  safe_install_directory "${deploy_dir}/log" 755 0 0
  safe_install_directory "${deploy_dir}/log/bot" 700 "${user_id}" "${group_id}"
  install -d -m 700 /etc/ickb/credentials
  install_unit "${network}" "${deploy_dir}"
  printf 'Installed %s with current release %s and shared logs under %s/log/bot.\n' "${service}" "$(readlink "${deploy_dir}/current")" "${deploy_dir}"
}

install_target() {
  case "$1" in
    testnet|mainnet) install_network "$1" ;;
    all)
      install_network testnet
      install_network mainnet
      ;;
  esac
}

main() {
  require_root
  require_runtime

  if [[ ${1:-} == --migrate ]]; then
    local network=${2:-}
    [[ $# -eq 2 && ( ${network} == testnet || ${network} == mainnet ) ]] || {
      usage
      exit 1
    }
    if ! id -u "ickb-bot-${network}" >/dev/null 2>&1; then
      useradd --system --create-home --user-group --shell /usr/sbin/nologin "ickb-bot-${network}"
    fi
    local lock_fd
    exec {lock_fd}>"/run/lock/ickb-bot-${network}-update.lock"
    flock -n "${lock_fd}" || {
      printf 'Another %s deployment operation is in progress.\n' "${network}" >&2
      exit 1
    }
    migrate_network "${network}"
    exit
  fi

  local target=${1:-all}
  [[ $# -le 1 ]] || {
    usage
    exit 1
  }
  case "${target}" in
    testnet|mainnet|all) install_target "${target}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  systemctl daemon-reload
  printf 'Next: create encrypted credentials, verify the units, then enable the services.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
