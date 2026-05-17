#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [testnet|mainnet|all]\n' "${0##*/}" >&2
}

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    printf 'Run this script as root, for example with sudo.\n' >&2
    exit 1
  fi
}

require_runtime() {
  if [[ ! -x /usr/bin/node ]]; then
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22 there or adjust the unit after install.\n' >&2
    exit 1
  fi
  /usr/bin/node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || {
    printf 'Node.js >=22 is required at /usr/bin/node. Found: %s\n' "$(/usr/bin/node --version)" >&2
    exit 1
  }
  command -v node >/dev/null || {
    printf 'node is required. Install Node.js >=22 before installing units.\n' >&2
    exit 1
  }
  command -v pnpm >/dev/null || {
    printf 'pnpm is required for deploy updates.\n' >&2
    exit 1
  }
}

install_network() {
  local network=$1
  local user="ickb-bot-${network}"
  local deploy_dir="/opt/ickb-stack-${network}"
  local credential="/etc/ickb/credentials/bot-${network}-private-key.cred"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"

  if ! id -u "${user}" >/dev/null 2>&1; then
    useradd --system --create-home --user-group --shell /usr/sbin/nologin "${user}"
  fi

  install -d -m 755 -o "${user}" -g "${user}" "${deploy_dir}"
  install -d -m 700 /etc/ickb/credentials

  cat >"${unit_path}" <<UNIT
[Unit]
Description=iCKB bot ${network}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${deploy_dir}
Environment=CHAIN=${network}
Environment=BOT_SLEEP_INTERVAL=60
Environment=BOT_PRIVATE_KEY_FILE=%d/bot-private-key
LoadCredentialEncrypted=bot-private-key:${credential}
ExecStart=/usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=2
NoNewPrivileges=true
PrivateTmp=true
ProtectProc=invisible
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT

  chmod 644 "${unit_path}"
  printf 'Installed %s for user %s in %s\n' "${service}" "${user}" "${deploy_dir}"
}

main() {
  require_root
  require_runtime

  local target=${1:-all}
  case "${target}" in
    testnet|mainnet)
      install_network "${target}"
      ;;
    all)
      install_network testnet
      install_network mainnet
      ;;
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
  printf 'Next: create credentials, deploy the repo to /opt/ickb-stack-<network>, build apps/bot, then enable the services.\n'
}

main "$@"
