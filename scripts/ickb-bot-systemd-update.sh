#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <testnet|mainnet>\n' "${0##*/}" >&2
}

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    printf 'Run this script as root, for example with sudo.\n' >&2
    exit 1
  fi
}

require_runtime() {
  if [[ ! -x /usr/bin/node ]]; then
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22 there or adjust the unit before updating.\n' >&2
    exit 1
  fi
  /usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || {
    printf 'Node.js >=22 is required at /usr/bin/node. Found: %s\n' "$(/usr/bin/node --version)" >&2
    exit 1
  }
  command -v pnpm >/dev/null || {
    printf 'pnpm is required before updating.\n' >&2
    exit 1
  }
  command -v git >/dev/null || {
    printf 'git is required before updating.\n' >&2
    exit 1
  }
}

service_user_home() {
  local user=$1
  local passwd_entry
  local user_home

  passwd_entry=$(getent passwd "${user}") || {
    printf 'User %s does not exist. Run bot:install first.\n' "${user}" >&2
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

require_clean_worktree() {
  local user=$1
  local user_home=$2
  local deploy_dir=$3

  if [[ -n $(run_as_service_user "${user}" "${user_home}" git -C "${deploy_dir}" status --porcelain) ]]; then
    printf 'Deploy checkout %s has local changes or untracked files; refusing to update.\n' "${deploy_dir}" >&2
    exit 1
  fi
}

require_launcher_unit() {
  local unit_path=$1
  local network=$2

  if [[ ! -r ${unit_path} ]]; then
    printf 'Service unit %s is missing or unreadable. Run scripts/ickb-bot-systemd-install.sh %s first.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi

  local unit_text
  unit_text=$(<"${unit_path}")
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"
  local log_root
  if ! log_root=$(unit_launcher_log_root "${unit_text}" "${network}"); then
    printf 'Service unit %s is not wired for production launcher file logging and core-dump hardening. Run scripts/ickb-bot-systemd-install.sh %s before updating.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi
  if ! unit_has_directive "${unit_text}" "Environment" "BOT_CONFIG_FILE=%d/${credential_name}" ||
     ! unit_has_directive "${unit_text}" "LoadCredentialEncrypted" "${credential_name}:${credential}" ||
      ! unit_has_directive "${unit_text}" "RestartPreventExitStatus" "2" ||
      ! unit_has_directive "${unit_text}" "LimitCORE" "0" ||
      ! unit_has_directive "${unit_text}" "ReadWritePaths" "${log_root}"; then
    printf 'Service unit %s is not wired for production launcher file logging and core-dump hardening. Run scripts/ickb-bot-systemd-install.sh %s before updating.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi
}

unit_has_directive() {
  local unit_text=$1
  local key=$2
  local expected=$3
  local line
  local value
  local in_service=0

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    if value=$(unit_directive_value "${line}" "${key}") && [[ ${value} == "${expected}" ]]; then
      return 0
    fi
  done <<<"${unit_text}"
  return 1
}

unit_directive_value() {
  local line=$1
  local expected_key=$2
  if [[ ${line} != *=* ]]; then
    return 1
  fi

  local key=${line%%=*}
  local value=${line#*=}
  key=$(trim_unit_field "${key}")
  value=$(trim_unit_field "${value}")
  if [[ ${key} != "${expected_key}" ]]; then
    return 1
  fi
  printf '%s\n' "${value}"
}

trim_unit_field() {
  local value=$1
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "${value}"
}

unit_launcher_log_root() {
  local unit_text=$1
  local network=$2
  local default_log_root="/opt/ickb-stack-${network}/log"
  local prefix="ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs "
  local suffix="--network ${network} -- /usr/bin/node apps/bot/dist/index.js"
  local with_log_root_prefix="${prefix}--log-root "
  local suffix_with_separator=" ${suffix}"
  local line
  local exec_start
  local in_service=0

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    if ! exec_start=$(unit_directive_value "${line}" "ExecStart"); then
      continue
    fi
    if [[ ${exec_start} == "${prefix#ExecStart=}${suffix}" ]]; then
      printf '%s\n' "${default_log_root}"
      return 0
    fi
    if [[ ${exec_start} == "${with_log_root_prefix#ExecStart=}"*"${suffix_with_separator}" ]]; then
      local rest=${exec_start#"${with_log_root_prefix#ExecStart=}"}
      local log_root_length=$(( ${#rest} - ${#suffix_with_separator} ))
      local log_root=${rest:0:log_root_length}
      if [[ -n ${log_root} && ${log_root} == /* && ${log_root} != *[[:space:]]* ]]; then
        printf '%s\n' "${log_root}"
        return 0
      fi
      return 1
    fi
  done <<<"${unit_text}"
  return 1
}

main() {
  require_root
  require_runtime

  local network=${1:-}
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

  local user="ickb-bot-${network}"
  local deploy_dir="/opt/ickb-stack-${network}"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  local user_home

  user_home=$(service_user_home "${user}")
  run_as_service_user "${user}" "${user_home}" git -C "${deploy_dir}" rev-parse --is-inside-work-tree >/dev/null
  require_clean_worktree "${user}" "${user_home}" "${deploy_dir}"
  require_launcher_unit "${unit_path}" "${network}"

  run_as_service_user "${user}" "${user_home}" git -C "${deploy_dir}" pull --ff-only
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${deploy_dir}" bot:install
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${deploy_dir}" bot:ccc
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${deploy_dir}" bot:build
  systemctl restart "${service}"
  systemctl --no-pager --full status "${service}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
