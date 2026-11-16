#!/usr/bin/env bash
# Deploy phase-2 contracts to Aevum testnet (chain 44005) — or to a local
# anvil with the same chain id (DEPLOY_RPC override).
#   DEPLOY_RPC (default https://rpc-test.qday.info)
#   DEPLOY_KEY (private key hex, no 0x prefix needed) — testnet-only throwaway
#   AGENT_URI (default: raw.githubusercontent URL of registration.json)
# Writes deployments.json (addresses + tx hashes) to the workdir.
# Deployer pays gas; contracts: TestUSD (EIP-3009), ERC-8004 Identity +
# Reputation registries via the reference HardhatMinimalUUPS -> ERC1967Proxy
# -> upgrade pattern, then the seller agent is registered (agentId 0).
# Written 2026-11-16. Never run against mainnet.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${DEPLOY_RPC:-https://rpc-test.qday.info}"
KEY="${DEPLOY_KEY:?DEPLOY_KEY (testnet-only deployer private key) is required}"
AGENT_URI="${AGENT_URI:-https://raw.githubusercontent.com/alfasurya91/x402-mint-radar/main/registration.json}"
export PATH="$HOME/.foundry/bin:$PATH"

DEPLOYER=$(cast wallet address --private-key "$KEY")
echo "deployer: $DEPLOYER"
echo "rpc: $RPC"
echo "balance: $(cast balance "$DEPLOYER" --rpc-url "$RPC") wei"

json_get() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

# 1. TestUSD (1,000,000 aUSD initial supply to the deployer).
echo "--- deploying TestUSD ---"
TOKEN_JSON=$(forge create contracts/TestUSD.sol:TestUSD \
  --rpc-url "$RPC" --private-key "$KEY" \
  --constructor-args=1000000000000 --gas-limit 3000000 --broadcast --json)
TOKEN=$(echo "$TOKEN_JSON" | json_get "['deployedTo']")
TOKEN_TX=$(echo "$TOKEN_JSON" | json_get "['transactionHash']")
echo "TestUSD: $TOKEN (tx $TOKEN_TX)"

# 2. Minimal UUPS implementation (shared by both proxies).
echo "--- deploying HardhatMinimalUUPS ---"
MIN_JSON=$(forge create contracts/vendor/HardhatMinimalUUPS.sol:HardhatMinimalUUPS \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 3000000 --broadcast --json)
MINIMAL=$(echo "$MIN_JSON" | json_get "['deployedTo']")
MIN_TX=$(echo "$MIN_JSON" | json_get "['transactionHash']")
echo "HardhatMinimalUUPS: $MINIMAL (tx $MIN_TX)"

# 3. Identity proxy: ERC1967Proxy(minimal, initialize(0x0)).
echo "--- deploying Identity proxy ---"
INIT_ZERO="0xc4d66de80000000000000000000000000000000000000000000000000000000000000000"
ID_PROXY_JSON=$(forge create lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --rpc-url "$RPC" --private-key "$KEY" \
  --gas-limit 3000000 --broadcast --json \
  --constructor-args "$MINIMAL" "$INIT_ZERO")
ID_PROXY=$(echo "$ID_PROXY_JSON" | json_get "['deployedTo']")
ID_PROXY_TX=$(echo "$ID_PROXY_JSON" | json_get "['transactionHash']")
echo "Identity proxy: $ID_PROXY (tx $ID_PROXY_TX)"

# 4. Identity implementation + upgrade.
echo "--- deploying IdentityRegistry implementation ---"
ID_IMPL_JSON=$(forge create contracts/vendor/IdentityRegistryUpgradeable.sol:IdentityRegistryUpgradeable \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 5000000 --broadcast --json)
ID_IMPL=$(echo "$ID_IMPL_JSON" | json_get "['deployedTo']")
ID_IMPL_TX=$(echo "$ID_IMPL_JSON" | json_get "['transactionHash']")
echo "Identity impl: $ID_IMPL (tx $ID_IMPL_TX)"
ID_UP_TX=$(cast send "$ID_PROXY" "upgradeToAndCall(address,bytes)" "$ID_IMPL" "0x8129fc1c" \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 1000000 --json | json_get "['transactionHash']")
echo "Identity upgrade tx: $ID_UP_TX"

# 5. Reputation proxy: ERC1967Proxy(minimal, initialize(identityProxy)).
echo "--- deploying Reputation proxy ---"
INIT_ID="0xc4d66de8${ID_PROXY#0x}"
# pad the address to 32 bytes
INIT_ID="0xc4d66de8$(python3 -c "print('${ID_PROXY#0x}'.rjust(64,'0'))")"
REP_PROXY_JSON=$(forge create lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --rpc-url "$RPC" --private-key "$KEY" \
  --gas-limit 3000000 --broadcast --json \
  --constructor-args "$MINIMAL" "$INIT_ID")
REP_PROXY=$(echo "$REP_PROXY_JSON" | json_get "['deployedTo']")
REP_PROXY_TX=$(echo "$REP_PROXY_JSON" | json_get "['transactionHash']")
echo "Reputation proxy: $REP_PROXY (tx $REP_PROXY_TX)"

# 6. Reputation implementation + upgrade.
echo "--- deploying ReputationRegistry implementation ---"
REP_IMPL_JSON=$(forge create contracts/vendor/ReputationRegistryUpgradeable.sol:ReputationRegistryUpgradeable \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 5000000 --broadcast --json)
REP_IMPL=$(echo "$REP_IMPL_JSON" | json_get "['deployedTo']")
REP_IMPL_TX=$(echo "$REP_IMPL_JSON" | json_get "['transactionHash']")
echo "Reputation impl: $REP_IMPL (tx $REP_IMPL_TX)"
REP_UP_TX=$(cast send "$REP_PROXY" "upgradeToAndCall(address,bytes)" "$REP_IMPL" "$INIT_ID" \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 1000000 --json | json_get "['transactionHash']")
echo "Reputation upgrade tx: $REP_UP_TX"

# 7. Register the seller agent (agentId 0).
echo "--- registering seller agent ---"
REG_TX=$(cast send "$ID_PROXY" "register(string)" "$AGENT_URI" \
  --rpc-url "$RPC" --private-key "$KEY" --gas-limit 1000000 --json | json_get "['transactionHash']")
echo "register tx: $REG_TX"
OWNER0=$(cast call "$ID_PROXY" "ownerOf(uint256)(address)" 0 --rpc-url "$RPC")
echo "ownerOf(0): $OWNER0 (expect $DEPLOYER)"
URI0=$(cast call "$ID_PROXY" "tokenURI(uint256)(string)" 0 --rpc-url "$RPC")
echo "tokenURI(0): $URI0"

cat > deployments.json <<EOF
{
  "chainId": 44005,
  "network": "Aevum Testnet",
  "rpc": "$RPC",
  "explorer": "https://explorer-test.qday.info",
  "deployer": "$DEPLOYER",
  "token": { "address": "$TOKEN", "name": "Aevum Test USD", "symbol": "aUSD", "decimals": 6, "tx": "$TOKEN_TX" },
  "identityRegistry": { "proxy": "$ID_PROXY", "implementation": "$ID_IMPL", "proxyTx": "$ID_PROXY_TX", "implementationTx": "$ID_IMPL_TX", "upgradeTx": "$ID_UP_TX" },
  "reputationRegistry": { "proxy": "$REP_PROXY", "implementation": "$REP_IMPL", "proxyTx": "$REP_PROXY_TX", "implementationTx": "$REP_IMPL_TX", "upgradeTx": "$REP_UP_TX" },
  "agent": { "agentId": 0, "agentURI": "$AGENT_URI", "registerTx": "$REG_TX", "owner": "$OWNER0" },
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "--- deployments.json written ---"
cat deployments.json
