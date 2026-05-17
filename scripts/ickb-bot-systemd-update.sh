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
}

require_clean_worktree() {
  local user=$1
  local deploy_dir=$2

  runuser -u "${user}" -- git -C "${deploy_dir}" diff --quiet
  runuser -u "${user}" -- git -C "${deploy_dir}" diff --cached --quiet
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
  local pnpm_bin
  pnpm_bin=$(command -v pnpm)

  id -u "${user}" >/dev/null
  runuser -u "${user}" -- git -C "${deploy_dir}" rev-parse --is-inside-work-tree >/dev/null
  require_clean_worktree "${user}" "${deploy_dir}"

  runuser -u "${user}" -- git -C "${deploy_dir}" pull --ff-only
  runuser -u "${user}" -- "${pnpm_bin}" -C "${deploy_dir}" bot:install
  runuser -u "${user}" -- "${pnpm_bin}" -C "${deploy_dir}" bot:ccc
  runuser -u "${user}" -- "${pnpm_bin}" -C "${deploy_dir}" bot:build
  systemctl restart "${service}"
  systemctl --no-pager --full status "${service}"
}

main "$@"
