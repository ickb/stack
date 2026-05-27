#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s [testnet|mainnet|all]\n' "${0##*/}" >&2
  printf 'Set ICKB_BOT_LOG_ROOT to bake an explicit launcher --log-root into generated units. Relative paths resolve from each deploy directory.\n' >&2
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

resolve_log_root_path() {
  local deploy_dir=$1
  local configured_log_root=$2

  node -e '
const path = require("node:path");
const deployDir = process.argv[1];
const configuredLogRoot = process.argv[2];
const resolved = path.isAbsolute(configuredLogRoot)
  ? path.resolve(configuredLogRoot)
  : path.resolve(deployDir, configuredLogRoot);
process.stdout.write(resolved);
' "${deploy_dir}" "${configured_log_root}"
}

require_systemd_safe_path_arg() {
  local value=$1

  node -e '
const value = process.argv[1] ?? "";
const disallowed = new Set([String.fromCharCode(34), String.fromCharCode(39), "\\", "$", "%", ";"]);
if (value === "" || [...value].some((char) => char.charCodeAt(0) <= 32 || disallowed.has(char))) {
  process.exit(1);
}
' "${value}" || {
    printf 'ICKB_BOT_LOG_ROOT must be a non-empty systemd-safe path without whitespace, quotes, backslashes, semicolons, $, or %%.\n' >&2
    exit 1
  }
}

safe_install_directory() {
  local path=$1
  local mode=$2
  local uid=$3
  local gid=$4

  node -e '
const fs = require("node:fs");
const path = require("node:path");

const target = process.argv[1];
const mode = Number.parseInt(process.argv[2], 8);
const uid = Number(process.argv[3]);
const gid = Number(process.argv[4]);

if (!path.isAbsolute(target) || !Number.isInteger(mode) || !Number.isInteger(uid) || !Number.isInteger(gid)) {
  fail(`Invalid directory install arguments: ${target}`);
}

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
  if (stat.isSymbolicLink()) {
    fail(`Refusing symlinked directory path: ${candidate}`);
  }
  if (!stat.isDirectory()) {
    fail(`Directory path is not a directory: ${candidate}`);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
' "${path}" "${mode}" "${uid}" "${gid}"
}

install_network() {
  local network=$1
  local user="ickb-bot-${network}"
  local deploy_dir="/opt/ickb-stack-${network}"
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local configured_log_root=${ICKB_BOT_LOG_ROOT:-}
  local launcher_log_root_args=
  local log_root_path="${deploy_dir}/log"

  if [[ -n ${configured_log_root} ]]; then
    require_systemd_safe_path_arg "${configured_log_root}"
    log_root_path=$(resolve_log_root_path "${deploy_dir}" "${configured_log_root}")
    launcher_log_root_args="--log-root ${log_root_path} "
  fi

  if ! id -u "${user}" >/dev/null 2>&1; then
    useradd --system --create-home --user-group --shell /usr/sbin/nologin "${user}"
  fi
  local user_id
  local group_id
  user_id=$(id -u "${user}")
  group_id=$(id -g "${user}")

  safe_install_directory "${deploy_dir}" 755 "${user_id}" "${group_id}"
  safe_install_directory "${log_root_path}" 755 0 0
  safe_install_directory "${log_root_path}/bot" 755 0 0
  safe_install_directory "${log_root_path}/bot/${network}" 700 "${user_id}" "${group_id}"
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
Environment=BOT_CONFIG_FILE=%d/${credential_name}
LoadCredentialEncrypted=${credential_name}:${credential}
ExecStart=/usr/bin/node scripts/ickb-bot-launcher.mjs ${launcher_log_root_args}--network ${network} -- /usr/bin/node apps/bot/dist/index.js
Restart=on-failure
RestartSec=10
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

  chmod 644 "${unit_path}"
  printf 'Installed %s for user %s in %s with logs under %s/bot/%s\n' "${service}" "${user}" "${deploy_dir}" "${log_root_path}" "${network}"
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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
