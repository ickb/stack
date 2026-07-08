#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <testnet|mainnet>\n' "${0##*/}" >&2
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
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there or adjust the unit before updating.\n' >&2
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
  local deploy_dir=$3

  if [[ ! -r ${unit_path} ]]; then
    printf 'Service unit %s is missing or unreadable. Run scripts/ickb-bot-systemd-install.sh %s first.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi

  local unit_text
  unit_text=$(<"${unit_path}")
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"
  local log_root="${deploy_dir}/log"
  if ! service_has_bot_environment "${unit_text}" "${credential_name}" ||
     ! service_has_line "${unit_text}" "LoadCredentialEncrypted=${credential_name}:${credential}" ||
     ! service_has_line "${unit_text}" "ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts --no-child-tee" ||
     ! service_has_line "${unit_text}" "RestartPreventExitStatus=2" ||
     ! service_has_line "${unit_text}" "LimitCORE=0" ||
     ! service_has_line "${unit_text}" "RestartSec=60" ||
     ! service_has_line "${unit_text}" "ReadWritePaths=${log_root}"; then
    printf 'Service unit %s is not wired for production launcher file logging and core-dump hardening. Run scripts/ickb-bot-systemd-install.sh %s before updating.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi
}

unit_working_directory() {
  local unit_path=$1
  local unit_text
  unit_text=$(<"${unit_path}")
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
    if [[ ${line} == WorkingDirectory=* ]]; then
      value=${line#WorkingDirectory=}
      printf '%s\n' "${value}"
      return 0
    fi
  done <<<"${unit_text}"
  return 1
}

require_unit_working_directory() {
  local unit_path=$1
  local network=$2
  local deploy_dir
  if ! deploy_dir=$(unit_working_directory "${unit_path}") || [[ -z ${deploy_dir} || ${deploy_dir} != /* ]]; then
    printf 'Service unit %s has no absolute WorkingDirectory. Run scripts/ickb-bot-systemd-install.sh %s from the deploy checkout before updating.\n' "${unit_path}" "${network}" >&2
    exit 1
  fi
  printf '%s\n' "${deploy_dir}"
}

service_has_line() {
  local unit_text=$1
  local expected=$2
  local line
  local in_service=0

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    if [[ ${line} == "${expected}" ]]; then
      return 0
    fi
  done <<<"${unit_text}"
  return 1
}

service_has_bot_environment() {
  local unit_text=$1
  local credential_name=$2
  local line
  local in_service=0
  local quota

  while IFS= read -r line || [[ -n ${line} ]]; do
    line=${line%$'\r'}
    [[ ${line} =~ ^[[:space:]]*($|#|\;) ]] && continue
    if [[ ${line} =~ ^[[:space:]]*\[(.*)\][[:space:]]*$ ]]; then
      [[ ${BASH_REMATCH[1]} == Service ]] && in_service=1 || in_service=0
      continue
    fi
    [[ ${in_service} -eq 1 ]] || continue
    if [[ ${line} == "Environment=BOT_CONFIG_FILE=%d/${credential_name}" ]]; then
      return 0
    fi
    if [[ ${line} == "Environment=BOT_CONFIG_FILE=%d/${credential_name} ICKB_BOT_LOG_STORAGE_QUOTA_BYTES="* ]]; then
      quota=${line#"Environment=BOT_CONFIG_FILE=%d/${credential_name} ICKB_BOT_LOG_STORAGE_QUOTA_BYTES="}
      [[ ${quota} =~ ^[1-9][0-9]*$ ]] && return 0
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
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local deploy_dir
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)
  local user_home

  user_home=$(service_user_home "${user}")
  deploy_dir=$(require_unit_working_directory "${unit_path}" "${network}")
  require_launcher_unit "${unit_path}" "${network}" "${deploy_dir}"
  run_as_service_user "${user}" "${user_home}" git -C "${deploy_dir}" rev-parse --is-inside-work-tree >/dev/null
  require_clean_worktree "${user}" "${user_home}" "${deploy_dir}"

  run_as_service_user "${user}" "${user_home}" git -C "${deploy_dir}" pull --ff-only
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${deploy_dir}" bot:install
  run_as_service_user "${user}" "${user_home}" "${pnpm_bin}" -C "${deploy_dir}" bot:check
  systemctl restart "${service}"
  systemctl --no-pager --full status "${service}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
