#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SuiBets P2P Betting Contract — Deploy Script
#
# Usage:
#   chmod +x contracts/p2p_betting/scripts/deploy.sh
#   ./contracts/p2p_betting/scripts/deploy.sh
#
# Requirements:
#   • sui CLI installed (downloaded to /tmp/sui or in PATH)
#   • ADMIN_PRIVATE_KEY env var set (suiprivkey..., 0x hex, or base64)
#   • Active environment pointed at mainnet
#   • Active address has ≥ 0.5 SUI for gas
#
# After successful deployment the script:
#   1. Prints all object IDs
#   2. Saves them to contracts/p2p_betting/deployed.env
#   3. Prints the environment secrets to add
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CONTRACT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "📦 Building + publishing from: $CONTRACT_DIR"

# ── Locate Sui CLI ──────────────────────────────────────────────────────────
SUI_BIN=""
if command -v sui &>/dev/null; then
  SUI_BIN="sui"
elif [ -x "/tmp/sui" ]; then
  SUI_BIN="/tmp/sui"
else
  echo "❌ sui CLI not found. Download it first." && exit 1
fi
echo "✅ Using Sui CLI: $($SUI_BIN --version)"

# ── Configure wallet from ADMIN_PRIVATE_KEY ──────────────────────────────────
if [ -z "${ADMIN_PRIVATE_KEY:-}" ]; then
  echo "❌ ADMIN_PRIVATE_KEY env var not set." && exit 1
fi

CONFIG_DIR="$HOME/.sui/sui_config"
mkdir -p "$CONFIG_DIR"

# Write keystore with the private key
cat > "$CONFIG_DIR/sui.keystore" <<EOF
["$ADMIN_PRIVATE_KEY"]
EOF

# Write client config pointing to mainnet
cat > "$CONFIG_DIR/client.yaml" <<EOF
---
keystore:
  File: $CONFIG_DIR/sui.keystore
envs:
  - alias: mainnet
    rpc: "https://fullnode.mainnet.sui.io:443"
    ws: ~
    basic_auth: ~
active_env: mainnet
active_address: ~
EOF

echo ""
echo "🔑 Wallet configured from ADMIN_PRIVATE_KEY"
ACTIVE_ADDR=$($SUI_BIN client active-address 2>/dev/null || echo "unknown")
echo "   Active address: $ACTIVE_ADDR"

# ── Check balance ────────────────────────────────────────────────────────────
echo ""
echo "💰 Checking SUI balance..."
BALANCE_OUT=$($SUI_BIN client balance 2>&1 || true)
echo "$BALANCE_OUT" | head -5

# ── 1. Build (dry-run) ───────────────────────────────────────────────────────
echo ""
echo "🔨 Building Move package..."
$SUI_BIN move build --path "$CONTRACT_DIR"

# ── 2. Publish ──────────────────────────────────────────────────────────────
echo ""
echo "🚀 Publishing to Sui mainnet..."
PUBLISH_OUT=$($SUI_BIN client publish \
  --path "$CONTRACT_DIR" \
  --gas-budget 500000000 \
  --json 2>&1)

echo "$PUBLISH_OUT" | tail -30

# ── 3. Extract all IDs using Node.js ────────────────────────────────────────
EXTRACT=$(node -e "
const raw = \`$PUBLISH_OUT\`;
let data;
// Find the JSON object in the output
const jsonStart = raw.indexOf('{');
if (jsonStart === -1) { console.error('No JSON found'); process.exit(1); }
try { data = JSON.parse(raw.slice(jsonStart)); } catch(e) { console.error('JSON parse error:', e.message); process.exit(1); }

const changes = data.objectChanges || [];

const pkg      = changes.find(o => o.type === 'published');
const config   = changes.find(o => o.type === 'created' && o.objectType?.includes('P2PConfig'));
const registry = changes.find(o => o.type === 'created' && o.objectType?.includes('P2PRegistry'));
const adminCap = changes.find(o => o.type === 'created' && o.objectType?.includes('AdminCap'));
const oracle   = changes.find(o => o.type === 'created' && o.objectType?.includes('OracleCap'));
const upgrade  = changes.find(o => o.type === 'created' && o.objectType?.includes('UpgradeCap'));

console.log('PACKAGE_ID='    + (pkg?.packageId      || ''));
console.log('CONFIG_ID='     + (config?.objectId     || ''));
console.log('REGISTRY_ID='   + (registry?.objectId   || ''));
console.log('ADMIN_CAP_ID='  + (adminCap?.objectId   || ''));
console.log('ORACLE_CAP_ID=' + (oracle?.objectId     || ''));
console.log('UPGRADE_CAP_ID='+ (upgrade?.objectId    || ''));
const digest = data.digest || data.effects?.transactionDigest || '';
console.log('TX_DIGEST=' + digest);
" 2>&1)

echo ""
echo "--- Extracted IDs ---"
echo "$EXTRACT"
echo "---------------------"

eval "$EXTRACT"

# ── 4. Update Move.toml with deployed package ID ─────────────────────────────
if [ -n "${PACKAGE_ID:-}" ]; then
  sed -i.bak "s|p2p_betting = \"0x0\"|p2p_betting = \"$PACKAGE_ID\"|" \
    "$CONTRACT_DIR/Move.toml"
  echo ""
  echo "✅ Move.toml updated with package ID: $PACKAGE_ID"
fi

# ── 5. Save deployed.env for reference ───────────────────────────────────────
cat > "$CONTRACT_DIR/deployed.env" <<EOF
P2P_PACKAGE_ID=$PACKAGE_ID
P2P_CONFIG_ID=$CONFIG_ID
P2P_REGISTRY_ID=$REGISTRY_ID
P2P_ADMIN_CAP_ID=$ADMIN_CAP_ID
P2P_ORACLE_CAP_ID=$ORACLE_CAP_ID
P2P_UPGRADE_CAP_ID=$UPGRADE_CAP_ID
DEPLOY_TX=$TX_DIGEST
DEPLOY_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DEPLOYED_BY=$ACTIVE_ADDR
EOF

echo ""
echo "✅ Saved to $CONTRACT_DIR/deployed.env"

# ── 6. Print summary ──────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🎉  P2P Betting Contract Deployed!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Add these environment secrets:"
echo ""
echo "  P2P_PACKAGE_ID    = ${PACKAGE_ID:-<see output above>}"
echo "  P2P_CONFIG_ID     = ${CONFIG_ID:-<see output above>}"
echo "  P2P_REGISTRY_ID   = ${REGISTRY_ID:-<see output above>}"
echo "  P2P_ADMIN_CAP_ID  = ${ADMIN_CAP_ID:-<see output above>}"
echo "  P2P_ORACLE_CAP_ID = ${ORACLE_CAP_ID:-<see output above>}"
echo "  P2P_UPGRADE_CAP_ID= ${UPGRADE_CAP_ID:-<see output above>}"
echo ""
echo "  Transaction:"
echo "  TX_DIGEST         = ${TX_DIGEST:-<see output above>}"
echo ""
echo "  SuiScan links:"
[ -n "${PACKAGE_ID:-}"    ] && echo "  Package   : https://suiscan.xyz/mainnet/object/$PACKAGE_ID"
[ -n "${CONFIG_ID:-}"     ] && echo "  Config    : https://suiscan.xyz/mainnet/object/$CONFIG_ID"
[ -n "${REGISTRY_ID:-}"   ] && echo "  Registry  : https://suiscan.xyz/mainnet/object/$REGISTRY_ID"
[ -n "${ADMIN_CAP_ID:-}"  ] && echo "  AdminCap  : https://suiscan.xyz/mainnet/object/$ADMIN_CAP_ID"
[ -n "${ORACLE_CAP_ID:-}" ] && echo "  OracleCap : https://suiscan.xyz/mainnet/object/$ORACLE_CAP_ID"
[ -n "${UPGRADE_CAP_ID:-}"] && echo "  UpgradeCap: https://suiscan.xyz/mainnet/object/$UPGRADE_CAP_ID"
[ -n "${TX_DIGEST:-}"     ] && echo "  Tx        : https://suiscan.xyz/mainnet/tx/$TX_DIGEST"
echo ""
echo "═══════════════════════════════════════════════════════════════"
