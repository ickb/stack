#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <testnet|mainnet>\n' "${0##*/}" >&2
  printf 'Run from the checkout to use as that service deployment. Generated units keep production bot logs under <checkout>/log.\n' >&2
  printf 'Set ICKB_BOT_LOG_STORAGE_QUOTA_BYTES to enable best-effort pruning of inactive per-run bot logs and artifacts.\n' >&2
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
    printf '/usr/bin/node is required because generated units use that path. Install Node.js >=22.19.0 there or adjust the unit after install.\n' >&2
    exit 1
  fi
  require_node_22_19 /usr/bin/node "at /usr/bin/node"
  command -v node >/dev/null || {
    printf 'node is required. Install Node.js >=22.19.0 before installing units.\n' >&2
    exit 1
  }
  require_node_22_19 "$(command -v node)" "on PATH"
  command -v pnpm >/dev/null || {
    printf 'pnpm is required for deploy updates.\n' >&2
    exit 1
  }
}

require_systemd_safe_positive_integer() {
  local name=$1
  local value=$2

  node -e '
const value = process.argv[1] ?? "";
process.exit(/^[1-9][0-9]*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? 0 : 1);
' "${value}" || {
    printf '%s must be a positive safe integer.\n' "${name}" >&2
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
  local deploy_dir=$2
  local user="ickb-bot-${network}"
  local credential_name="ickb-bot-${network}-config.json"
  local credential="/etc/ickb/credentials/ickb-bot-${network}-config.cred"
  local service="ickb-bot-${network}.service"
  local unit_path="/etc/systemd/system/${service}"
  local configured_log_quota=${ICKB_BOT_LOG_STORAGE_QUOTA_BYTES:-}
  local launcher_quota_environment=
  local log_root_path="${deploy_dir}/log"

  if [[ -n ${configured_log_quota} ]]; then
    require_systemd_safe_positive_integer ICKB_BOT_LOG_STORAGE_QUOTA_BYTES "${configured_log_quota}"
    launcher_quota_environment=" ICKB_BOT_LOG_STORAGE_QUOTA_BYTES=${configured_log_quota}"
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
  safe_install_directory "${log_root_path}/bot" 700 "${user_id}" "${group_id}"
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
Environment=BOT_CONFIG_FILE=%d/${credential_name}${launcher_quota_environment}
LoadCredentialEncrypted=${credential_name}:${credential}
ExecStart=/usr/bin/node --experimental-default-type=module scripts/bot/launcher.ts --no-child-tee
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

  chmod 644 "${unit_path}"
  printf 'Installed %s for user %s in %s with logs under %s/bot\n' "${service}" "${user}" "${deploy_dir}" "${log_root_path}"
}

main() {
  require_root
  require_runtime

  local deploy_dir
  deploy_dir=$(pwd -P)

  local target=${1:-}
  case "${target}" in
    testnet|mainnet)
      install_network "${target}" "${deploy_dir}"
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
  printf 'Next: create credentials, install dependencies, type-check source, then enable the services.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
