#!/usr/bin/env bash
set -euo pipefail

readonly RELEASES_TO_KEEP=3
readonly DEFAULT_READINESS_TIMEOUT_SECONDS=120
readonly MAX_READINESS_TIMEOUT_SECONDS=600

usage() {
  printf 'Usage: %s <testnet|mainnet> <revision>\n' "${0##*/}" >&2
  printf 'Revision must name a commit, tag, or branch available from the deployed checkout origin.\n' >&2
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
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there before updating.\n' >&2
    exit 1
  fi
  require_node_22_19 /usr/bin/node "at /usr/bin/node"
  command -v pnpm >/dev/null || {
    printf 'pnpm is required before updating.\n' >&2
    exit 1
  }
  command -v git >/dev/null || {
    printf 'git is required before updating.\n' >&2
    exit 1
  }
  command -v flock >/dev/null || {
    printf 'flock is required before updating.\n' >&2
    exit 1
  }
}

require_positive_integer() {
  local name=$1
  local value=$2
  [[ ${value} =~ ^[1-9][0-9]*$ ]] || {
    printf '%s must be a positive integer.\n' "${name}" >&2
    exit 1
  }
}

require_readiness_timeout() {
  local value=$1
  require_positive_integer ICKB_BOT_UPDATE_READINESS_TIMEOUT_SECONDS "${value}"
  if (( value > MAX_READINESS_TIMEOUT_SECONDS )); then
    printf 'ICKB_BOT_UPDATE_READINESS_TIMEOUT_SECONDS must not exceed %s.\n' "${MAX_READINESS_TIMEOUT_SECONDS}" >&2
    exit 1
  fi
}

require_safe_revision() {
  local revision=$1
  if [[ ! ${revision} =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ||
        ${revision} == *..* || ${revision} == */ || ${revision} == *//* ]]; then
    printf 'Revision contains unsupported characters or path components.\n' >&2
    exit 1
  fi
}

service_user_home() {
  local user=$1
  local passwd_entry
  local user_home

  passwd_entry=$(getent passwd "${user}") || {
    printf 'User %s does not exist. Run the systemd installer first.\n' "${user}" >&2
    exit 1
  }
  IFS=: read -r _ _ _ _ _ user_home _ <<<"${passwd_entry}"
  if [[ -z ${user_home} ]]; then
    printf 'User %s has no home directory.\n' "${user}" >&2
    exit 1
  fi
  printf '%s\n' "${user_home}"
}

run_as_service_user() {
  local user=$1
  local user_home=$2
  shift 2
  runuser -u "${user}" -- env HOME="${user_home}" USER="${user}" LOGNAME="${user}" SHELL=/bin/bash "$@"
}

unit_directive_value() {
  local line=$1
  local expected_key=$2
  [[ ${line} == *=* ]] || return 1

  local key=${line%%=*}
  local value=${line#*=}
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  [[ ${key} == "${expected_key}" ]] || return 1
  printf '%s\n' "${value}"
}

unit_value_contains_token() {
  local value=$1
  local expected=$2
  local token
  local -a tokens
  read -r -a tokens <<<"${value}"
  for token in "${tokens[@]}"; do
    token=${token#\"}
    token=${token%\"}
    [[ ${token} == "${expected}" ]] && return 0
  done
  return 1
}

unit_has_directive() {
  local unit_text=$1
  local key=$2
  local expected=$3
  local line
  local value
  local in_service=0
  local found=0
  local matched=0

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    if value=$(unit_directive_value "${line}" "${key}"); then
      found=$((found + 1))
      if [[ ${value} == "${expected}" ]]; then
        matched=$((matched + 1))
      elif [[ ${key} == Environment ]] && unit_value_contains_token "${value}" "${expected}"; then
        matched=$((matched + 1))
      fi
    fi
  done <<<"${unit_text}"
  [[ ${found} -eq 1 && ${matched} -eq 1 ]]
}

unit_has_environment_name() {
  local unit_text=$1
  local name=$2
  local line
  local value
  local token
  local -a tokens
  local in_service=0

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    value=$(unit_directive_value "${line}" Environment) || continue
    read -r -a tokens <<<"${value}"
    for token in "${tokens[@]}"; do
      token=${token#\"}
      token=${token%\"}
      [[ ${token} == "${name}" || ${token} == "${name}="* ]] && return 0
    done
  done <<<"${unit_text}"
  return 1
}

require_bot_unit() {
  local unit_path=$1
  local network=$2
  local deploy_dir=$3
  local current_path="${deploy_dir}/current"
  local log_root="${deploy_dir}/log"
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"

  if [[ ! -r ${unit_path} ]]; then
    printf 'Service unit %s is missing or unreadable. Run the systemd installer first.\n' "${unit_path}" >&2
    exit 1
  fi
  local unit_text
  unit_text=$(<"${unit_path}")
  if unit_has_environment_name "${unit_text}" ICKB_BOT_LOG_ROOT ||
     ! unit_has_directive "${unit_text}" WorkingDirectory "${current_path}" ||
     ! unit_has_directive "${unit_text}" Environment "BOT_CONFIG_FILE=%d/${credential_name}" ||
     ! unit_has_directive "${unit_text}" LoadCredentialEncrypted "${credential_name}:${credential}" ||
     ! unit_has_directive "${unit_text}" Environment "BOT_ARTIFACT_ROOT=${log_root}/bot/artifacts" ||
     ! unit_has_directive "${unit_text}" ExecStart "/usr/bin/node apps/bot/src/index.ts" ||
     ! unit_has_directive "${unit_text}" RestartPreventExitStatus 2 ||
     ! unit_has_directive "${unit_text}" RestartSec 60 ||
     ! unit_has_directive "${unit_text}" LimitCORE 0 ||
     ! unit_has_directive "${unit_text}" NoNewPrivileges true ||
     ! unit_has_directive "${unit_text}" PrivateTmp true ||
     ! unit_has_directive "${unit_text}" ProtectProc invisible ||
     ! unit_has_directive "${unit_text}" ProtectSystem strict ||
     ! unit_has_directive "${unit_text}" ReadWritePaths "${log_root}" ||
     ! unit_has_directive "${unit_text}" ProtectHome true; then
    printf 'Service unit %s does not match the safe release layout. Run the systemd installer before updating.\n' "${unit_path}" >&2
    exit 1
  fi
}

require_deployment_layout() {
  local deploy_dir=$1
  node - "${deploy_dir}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const releases = path.join(root, "releases");
const current = path.join(root, "current");
const log = path.join(root, "log");
for (const candidate of [root, releases, log, path.join(log, "bot")]) {
  assertRealDirectory(candidate);
}
const currentStat = fs.lstatSync(current);
if (!currentStat.isSymbolicLink()) fail(`${current} must be a symbolic link`);
const target = fs.readlinkSync(current);
if (!/^releases\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(target)) {
  fail(`${current} must point directly to a named release`);
}
const release = path.join(root, target);
assertRealDirectory(release);
assertRealDirectory(path.join(release, ".git"));
if (fs.realpathSync(current) !== fs.realpathSync(release)) fail(`${current} has an invalid target`);
process.stdout.write(`${fs.realpathSync(release)}\n`);

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

require_clean_release() {
  local user=$1
  local user_home=$2
  local release=$3
  if [[ -n $(run_as_service_user "${user}" "${user_home}" git -c safe.directory="${release}" -C "${release}" status --porcelain --untracked-files=all) ]]; then
    printf 'Release %s is not a clean checkout.\n' "${release}" >&2
    return 1
  fi
  run_as_service_user "${user}" "${user_home}" git -c safe.directory="${release}" -C "${release}" diff --check
}

prepare_release() {
  local user=$1
  local user_home=$2
  local source_release=$3
  local releases_dir=$4
  local revision=$5
  local pnpm_bin=$6
  local staging=$7

  run_as_service_user "${user}" "${user_home}" mkdir "${staging}"
  run_as_service_user "${user}" "${user_home}" cp -R "${source_release}/.git" "${staging}/.git"
  run_as_service_user "${user}" "${user_home}" git -C "${staging}" reset --hard HEAD
  run_as_service_user "${user}" "${user_home}" git -C "${staging}" clean -ffd
  run_as_service_user "${user}" "${user_home}" git -C "${staging}" fetch --force --prune origin "${revision}"
  run_as_service_user "${user}" "${user_home}" git -C "${staging}" checkout --detach --force FETCH_HEAD
  run_as_service_user "${user}" "${user_home}" git -C "${staging}" clean -ffd
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${staging}" bot:install
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${staging}" bot:check
  require_clean_release "${user}" "${user_home}" "${staging}"

  local commit
  commit=$(run_as_service_user "${user}" "${user_home}" git -C "${staging}" rev-parse --verify HEAD)
  [[ ${commit} =~ ^[0-9a-f]{40,64}$ ]] || {
    printf 'Target revision did not resolve to a full commit ID.\n' >&2
    return 1
  }
  local release_id
  release_id="$(date -u +%Y%m%dT%H%M%S%N)-${commit:0:12}"
  local release="${releases_dir}/${release_id}"
  [[ ! -e ${release} && ! -L ${release} ]] || {
    printf 'Release path collision: %s\n' "${release}" >&2
    return 1
  }
  mv "${staging}" "${release}"
  chown -R root:root "${release}"
  chmod -R a-w "${release}"
  prepared_release=${release}
}

# Readiness: the running invocation's journal carries a canonical bot.chain.preflight for the network.
readonly READINESS_PROBE_JS='
const fs = require("node:fs");
const expectedNetwork = process.argv[1];
for (const line of fs.readFileSync(0, "utf8").split("\n")) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (canonicalPreflight(event)) process.exit(0);
}
process.exit(1);
function canonicalPreflight(event) {
  return event?.version === 1 && event?.app === "bot" && event?.type === "bot.chain.preflight" &&
    event?.chain === expectedNetwork && typeof event?.runId === "string" && event.runId !== "" &&
    event?.iterationId === 0 && typeof event?.timestamp === "string" && isIsoTimestamp(event.timestamp) &&
    event?.expected?.chain === expectedNetwork &&
    typeof event?.expected?.genesisHash === "string" && event.expected.genesisHash !== "" &&
    typeof event?.expected?.addressPrefix === "string" && event.expected.addressPrefix !== "" &&
    event?.observed?.genesisHash === event.expected.genesisHash &&
    event?.observed?.addressPrefix === event.expected.addressPrefix &&
    event?.matches?.genesisHash === true && event?.matches?.addressPrefix === true;
}
function isIsoTimestamp(value) {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}
'

readiness_probe() {
  node -e "${READINESS_PROBE_JS}" "$1"
}

invocation_journal() {
  local service=$1
  local invocation
  invocation=$(systemctl show -p InvocationID --value "${service}") || return 1
  [[ -n ${invocation} ]] || return 1
  journalctl --no-pager -o cat "_SYSTEMD_INVOCATION_ID=${invocation}"
}

wait_for_readiness() {
  local service=$1
  local network=$2
  local timeout_seconds=$3
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if systemctl is-active --quiet "${service}" &&
       invocation_journal "${service}" | readiness_probe "${network}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

atomic_switch() {
  local deploy_dir=$1
  local target=$2
  local pending="${deploy_dir}/current.new"
  [[ ${target} =~ ^releases/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  [[ -d ${deploy_dir}/${target} && ! -L ${deploy_dir}/${target} ]] || return 1
  rm -f "${pending}"
  ln -s "${target}" "${pending}"
  mv -Tf "${pending}" "${deploy_dir}/current"
}

activate_release() {
  local service=$1
  local deploy_dir=$2
  local new_release=$3
  local previous_target=$4
  local network=$5
  local timeout_seconds=$6
  local new_target="releases/${new_release##*/}"

  candidate_removable=1
  if ! systemctl stop "${service}"; then
    systemctl start "${service}" || true
    printf 'Service stop failed before the release switch; the previous current target was retained.\n' >&2
    return 1
  fi
  if ! atomic_switch "${deploy_dir}" "${new_target}"; then
    if ! systemctl start "${service}" ||
       ! wait_for_readiness "${service}" "${network}" "${timeout_seconds}"; then
      printf 'Atomic release switch failed and previous-release readiness could not be restored.\n' >&2
      return 1
    fi
    printf 'Atomic release switch failed; the previous current target was retained.\n' >&2
    return 1
  fi
  candidate_removable=0
  if systemctl start "${service}" &&
      wait_for_readiness "${service}" "${network}" "${timeout_seconds}"; then
    return 0
  fi

  printf 'New release did not become ready; restoring the previous release.\n' >&2
  if ! systemctl stop "${service}"; then
    printf 'Candidate stop failed; current remains on the candidate and its release was retained for operator recovery.\n' >&2
    return 1
  fi
  if ! atomic_switch "${deploy_dir}" "${previous_target}"; then
    printf 'Rollback switch failed; service remains stopped for operator recovery.\n' >&2
    return 1
  fi
  if ! systemctl restart "${service}" ||
     ! wait_for_readiness "${service}" "${network}" "${timeout_seconds}"; then
    printf 'Rollback release did not become ready; immediate operator intervention is required.\n' >&2
    return 1
  fi
  candidate_removable=1
  printf 'Rollback release is ready; update failed without changing the active release.\n' >&2
  return 1
}

prune_releases() {
  local releases_dir=$1
  local active_target=$2
  local rollback_target=$3
  local active=${active_target#releases/}
  local rollback=${rollback_target#releases/}
  local -a candidates=()
  local release
  for release in "${releases_dir}"/*; do
    [[ -d ${release} && ! -L ${release} ]] || continue
    candidates+=("${release##*/}")
  done
  mapfile -t candidates < <(printf '%s\n' "${candidates[@]}" | sort -r)

  local kept=0
  [[ -d ${releases_dir}/${active} && ! -L ${releases_dir}/${active} ]] && kept=$((kept + 1))
  if [[ ${rollback} != "${active}" && -d ${releases_dir}/${rollback} && ! -L ${releases_dir}/${rollback} ]]; then
    kept=$((kept + 1))
  fi
  local name
  for name in "${candidates[@]}"; do
    if [[ ${name} == "${active}" || ${name} == "${rollback}" ]]; then
      continue
    fi
    if (( kept < RELEASES_TO_KEEP )); then
      kept=$((kept + 1))
      continue
    fi
    rm -rf -- "${releases_dir:?}/${name}"
  done
}

main() {
  require_root
  require_runtime

  local network=${1:-}
  local revision=${2:-}
  case "${network}" in
    testnet|mainnet) ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  [[ -n ${revision} && $# -eq 2 ]] || {
    usage
    exit 1
  }
  require_safe_revision "${revision}"

  local timeout_seconds=${ICKB_BOT_UPDATE_READINESS_TIMEOUT_SECONDS:-${DEFAULT_READINESS_TIMEOUT_SECONDS}}
  require_readiness_timeout "${timeout_seconds}"

  local lock_path="/run/lock/ickb-bot-${network}-update.lock"
  local lock_fd
  exec {lock_fd}>"${lock_path}"
  if ! flock -n "${lock_fd}"; then
    printf 'Another %s deployment operation holds %s.\n' "${network}" "${lock_path}" >&2
    exit 1
  fi

  local deploy_dir
  deploy_dir=$(deployment_root "${network}")
  local releases_dir="${deploy_dir}/releases"
  local user="ickb-bot-${network}"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local user_home
  user_home=$(service_user_home "${user}")
  require_bot_unit "${unit_path}" "${network}" "${deploy_dir}"
  local previous_release
  previous_release=$(require_deployment_layout "${deploy_dir}")
  local previous_target
  previous_target=$(readlink "${deploy_dir}/current")
  require_clean_release "${user}" "${user_home}" "${previous_release}"
  systemctl is-active --quiet "${service}" || {
    printf 'Service %s must be active before an update so rollback readiness can be proved.\n' "${service}" >&2
    exit 1
  }

  local staging="${releases_dir}/.staging-${BASHPID}"
  [[ ! -e ${staging} && ! -L ${staging} ]] || {
    printf 'Staging path already exists: %s\n' "${staging}" >&2
    exit 1
  }
  trap 'if [[ -n ${staging:-} && ( -e ${staging} || -L ${staging} ) ]]; then rm -rf -- "${staging}"; fi' EXIT
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  local new_release
  prepared_release=
  prepare_release "${user}" "${user_home}" "${previous_release}" "${releases_dir}" "${revision}" "${pnpm_bin}" "${staging}"
  new_release=${prepared_release}
  staging=

  local previous_commit
  local new_commit
  previous_commit=$(git -C "${previous_release}" rev-parse --verify HEAD)
  new_commit=$(git -C "${new_release}" rev-parse --verify HEAD)
  if [[ ${previous_commit} == "${new_commit}" ]]; then
    rm -rf -- "${new_release}"
    printf 'Revision %s is already active for %s; no switch was needed.\n' "${new_commit}" "${network}"
    exit 0
  fi

  candidate_removable=0
  if ! activate_release "${service}" "${deploy_dir}" "${new_release}" "${previous_target}" "${network}" "${timeout_seconds}"; then
    if (( candidate_removable == 1 )) && [[ $(readlink "${deploy_dir}/current") == "${previous_target}" ]]; then
      rm -rf -- "${new_release}"
    fi
    exit 1
  fi

  prune_releases "${releases_dir}" "releases/${new_release##*/}" "${previous_target}"
  printf 'Activated %s for %s; readiness was proved from the bot preflight journal entry of the new invocation.\n' "${new_commit}" "${network}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
