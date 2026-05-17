#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <testnet|mainnet> [--force]\n' "${0##*/}" >&2
}

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    printf 'Run this script as root, for example with sudo.\n' >&2
    exit 1
  fi
}

main() {
  require_root

  local network=${1:-}
  local force=${2:-}
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
  if [[ -n "${force}" && "${force}" != "--force" ]]; then
    usage
    exit 1
  fi

  command -v systemd-creds >/dev/null || {
    printf 'systemd-creds is required.\n' >&2
    exit 1
  }
  command -v systemd-ask-password >/dev/null || {
    printf 'systemd-ask-password is required.\n' >&2
    exit 1
  }

  local credential_dir=/etc/ickb/credentials
  local credential="${credential_dir}/bot-${network}-private-key.cred"
  if [[ -e "${credential}" && "${force}" != "--force" ]]; then
    printf '%s already exists; rerun with --force to rotate it.\n' "${credential}" >&2
    exit 1
  fi

  install -d -m 700 "${credential_dir}"
  local tmp
  tmp=$(mktemp "${credential_dir}/.bot-${network}.XXXXXX")
  trap 'rm -f "${tmp}"' EXIT

  umask 077
  systemd-ask-password -n "iCKB ${network} bot private key:" |
    systemd-creds encrypt --with-key=host --name=bot-private-key - "${tmp}"
  install -m 600 "${tmp}" "${credential}"
  systemd-creds decrypt --name=bot-private-key "${credential}" >/dev/null
  printf 'Wrote encrypted credential %s\n' "${credential}"
}

main "$@"
