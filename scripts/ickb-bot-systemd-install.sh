#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [testnet|mainnet|all]\n' "${0##*/}" >&2
  printf 'Fresh installs publish the invoking clean checkout HEAD.\n' >&2
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
Environment=BOT_CONFIG_FILE=%d/${credential_name} BOT_ARTIFACT_ROOT=${log_root_path}/bot/artifacts
LoadCredentialEncrypted=${credential_name}:${credential}
ExecStart=/usr/bin/node apps/bot/src/index.ts
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
