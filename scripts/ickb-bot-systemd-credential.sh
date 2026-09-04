#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <testnet|mainnet> [--force]\n' "${0##*/}" >&2
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

validate_config() {
  local expected_chain=$1
  local repo_root=$2
  node -e '
(async () => {
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const repoRoot = process.argv[1];
const expectedChain = process.argv[2];
const text = readFileSync(0, "utf8");
let config;
try {
  const { parseRuntimeConfig } = await import(pathToFileURL(`${repoRoot}/packages/node-utils/src/index.ts`).href);
  parseRuntimeConfig(text, "BOT_CONFIG_FILE");
  config = JSON.parse(text);
} catch {
  fail();
}
if (config.chain !== expectedChain) fail();
process.stdout.write(JSON.stringify(config));
})();
function fail() {
  process.stderr.write("Invalid bot config: expected exact JSON with matching chain, privateKey, and rpcUrl.\n");
  process.exit(1);
}
' "${repo_root}" "${expected_chain}"
}

install_credential_candidate() {
  local expected_chain=$1
  local repo_root=$2
  local credential_name=$3
  local candidate=$4
  local credential=$5

  systemd-creds decrypt --name="${credential_name}" "${candidate}" |
    validate_config "${expected_chain}" "${repo_root}" >/dev/null
  chmod 600 "${candidate}"
  sync -f "${candidate}"
  mv -f -- "${candidate}" "${credential}"
  sync -f "$(dirname -- "${credential}")"
}

main() {
  require_root

  local script_dir
  local repo_root
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  repo_root=$(cd -- "${script_dir}/.." && pwd)

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
    printf 'node >=22.19.0 is required to validate the config before encrypting.\n' >&2
    exit 1
  }
  require_node_22_19 "$(command -v node)" "to validate TypeScript source configs"
  if [[ ! -e /var/lib/systemd/credential.secret ]]; then
    systemd-creds setup
  fi
  if [[ ! -r "${repo_root}/packages/node-utils/src/index.ts" ]]; then
    printf 'Missing @ickb/node-utils source in %s.\n' "${repo_root}" >&2
    exit 1
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
  trap "rm -f -- $(printf '%q' "${tmp}")" EXIT

  umask 077
  local private_key
  local rpc_url
  private_key=$(systemd-ask-password -n "iCKB ${network} bot private key:")
  rpc_url=$(systemd-ask-password -n "iCKB ${network} RPC URL:")
  printf '%s\0%s\0%s' "${network}" "${private_key}" "${rpc_url}" |
  node -e '
const [chain, privateKey, rpcUrl] = require("node:fs").readFileSync(0).toString("utf8").split("\0");
process.stdout.write(JSON.stringify({ chain, privateKey, rpcUrl }));
' |
    validate_config "${network}" "${repo_root}" |
    systemd-creds encrypt --with-key=host --name="${credential_name}" - "${tmp}"
  install_credential_candidate "${network}" "${repo_root}" "${credential_name}" "${tmp}" "${credential}"
  printf 'Wrote encrypted credential %s\n' "${credential}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
