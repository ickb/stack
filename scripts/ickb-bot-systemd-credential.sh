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

validate_config() {
  local expected_chain=$1
  node -e '
const { readFileSync } = require("node:fs");
const expectedChain = process.argv[1];
const text = readFileSync(0, "utf8");
let config;
try {
  config = JSON.parse(text);
} catch {
  fail();
}
if (typeof config !== "object" || config === null || Array.isArray(config)) fail();
for (const key of Object.keys(config)) {
  if (!["chain", "privateKey", "rpcUrl", "sleepIntervalSeconds", "maxIterations"].includes(key)) fail();
}
if (config.chain !== expectedChain) fail();
if (typeof config.privateKey !== "string" || !/^0x[0-9a-f]{64}$/u.test(config.privateKey)) fail();
if (typeof config.rpcUrl !== "string" || /\s|[\u0000-\u001f\u007f]/u.test(config.rpcUrl)) fail();
let rpcUrl;
try {
  rpcUrl = new URL(config.rpcUrl);
} catch {
  fail();
}
if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") fail();
if (typeof config.sleepIntervalSeconds !== "number" || !Number.isFinite(config.sleepIntervalSeconds) || config.sleepIntervalSeconds < 1) fail();
if (config.maxIterations !== undefined && (!Number.isSafeInteger(config.maxIterations) || config.maxIterations < 1)) fail();
process.stdout.write(JSON.stringify(config));
function fail() {
  process.stderr.write("Invalid bot config: expected exact JSON with chain, privateKey, rpcUrl, sleepIntervalSeconds, and optional maxIterations.\n");
  process.exit(1);
}
' "${expected_chain}"
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
  command -v node >/dev/null || {
    printf 'node is required to validate the config before encrypting.\n' >&2
    exit 1
  }
  if [[ ! -e /var/lib/systemd/credential.secret ]]; then
    systemd-creds setup
  fi

  local credential_dir=/etc/ickb/credentials
  local credential_name="ickb-bot-${network}-config.json"
  local credential="${credential_dir}/ickb-bot-${network}-config.cred"
  if [[ -e "${credential}" && "${force}" != "--force" ]]; then
    printf '%s already exists; rerun with --force to rotate it.\n' "${credential}" >&2
    exit 1
  fi

  install -d -m 700 "${credential_dir}"
  local tmp
  tmp=$(mktemp "${credential_dir}/.bot-${network}.XXXXXX")
  trap 'rm -f "${tmp}"' EXIT

  umask 077
  local private_key
  local rpc_url
  local sleep_interval
  local max_iterations
  private_key=$(systemd-ask-password -n "iCKB ${network} bot private key:")
  rpc_url=$(systemd-ask-password --echo=yes -n "iCKB ${network} RPC URL:")
  read -r -p "iCKB ${network} bot sleep interval seconds [60]: " sleep_interval
  sleep_interval=${sleep_interval:-60}
  read -r -p "iCKB ${network} bot max iterations [empty for unbounded]: " max_iterations
  printf '%s\0%s\0%s\0%s\0%s' "${network}" "${private_key}" "${rpc_url}" "${sleep_interval}" "${max_iterations}" |
  node -e '
const input = require("node:fs").readFileSync(0).toString("utf8").split("\0");
const [chain, privateKey, rpcUrl, sleepIntervalSeconds, maxIterations] = input;
const config = {
  chain,
  privateKey,
  rpcUrl,
  sleepIntervalSeconds: Number(sleepIntervalSeconds),
};
if (maxIterations !== "") {
  config.maxIterations = Number(maxIterations);
}
process.stdout.write(JSON.stringify(config));
' |
    validate_config "${network}" |
    systemd-creds encrypt --with-key=host --name="${credential_name}" - "${tmp}"
  install -m 600 "${tmp}" "${credential}"
  systemd-creds decrypt --name="${credential_name}" "${credential}" | validate_config "${network}" >/dev/null
  printf 'Wrote encrypted credential %s\n' "${credential}"
}

main "$@"
