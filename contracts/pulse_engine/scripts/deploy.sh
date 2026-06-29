#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PULSE Engine Deploy Script
#
# Usage:
#   chmod +x contracts/pulse_engine/scripts/deploy.sh
#   ./contracts/pulse_engine/scripts/deploy.sh
#
# Requirements:
#   • /tmp/sui binary present
#   • ADMIN_PRIVATE_KEY env var set
#   • Active address has ≥ 0.5 SUI for gas
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CONTRACT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "📦 Building + publishing PULSE Engine from: $CONTRACT_DIR"

# ── Locate Sui CLI ────────────────────────────────────────────────────────────
SUI_BIN=""
if command -v sui &>/dev/null; then
  SUI_BIN="sui"
elif [ -x "/tmp/sui" ]; then
  SUI_BIN="/tmp/sui"
else
  echo "❌ sui CLI not found at /tmp/sui or in PATH." && exit 1
fi
echo "✅ Using Sui CLI: $($SUI_BIN --version)"

# ── Configure wallet ──────────────────────────────────────────────────────────
if [ -z "${ADMIN_PRIVATE_KEY:-}" ]; then
  echo "❌ ADMIN_PRIVATE_KEY env var not set." && exit 1
fi

CONFIG_DIR="$HOME/.sui/sui_config"
mkdir -p "$CONFIG_DIR"

cat > "$CONFIG_DIR/sui.keystore" <<EOF
["$ADMIN_PRIVATE_KEY"]
EOF

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

ACTIVE_ADDR=$($SUI_BIN client active-address 2>/dev/null || echo "unknown")
echo "🔑 Active address: $ACTIVE_ADDR"

# ── Balance check ─────────────────────────────────────────────────────────────
echo ""
echo "💰 Checking SUI balance..."
$SUI_BIN client balance 2>&1 | head -5 || true

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building PULSE Engine..."
$SUI_BIN move build --path "$CONTRACT_DIR" --allow-dirty

# ── Publish ───────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Publishing PULSE Engine to Sui mainnet..."
PUBLISH_OUT=$($SUI_BIN client publish \
  --path "$CONTRACT_DIR" \
  --gas-budget 500000000 \
  --allow-dirty \
  --json 2>&1)

echo "$PUBLISH_OUT" | tail -20

# ── Extract IDs ───────────────────────────────────────────────────────────────
EXTRACT=$(node -e "
const raw = \`$PUBLISH_OUT\`;
const jsonStart = raw.indexOf('{');
if (jsonStart === -1) { console.error('No JSON found in output'); process.exit(1); }
let data;
try { data = JSON.parse(raw.slice(jsonStart)); } catch(e) { console.error('JSON parse error:', e.message); process.exit(1); }
const changes = data.objectChanges || [];
const pkg      = changes.find(o => o.type === 'published');
const stats    = changes.find(o => o.type === 'created' && o.objectType?.includes('PulseStats'));
const adminCap = changes.find(o => o.type === 'created' && o.objectType?.includes('PulseAdminCap'));
const upgrade  = changes.find(o => o.type === 'created' && o.objectType?.includes('UpgradeCap'));
const digest   = data.digest || data.effects?.transactionDigest || '';
console.log('PULSE_PACKAGE_ID='    + (pkg?.packageId    || ''));
console.log('PULSE_STATS_ID='      + (stats?.objectId    || ''));
console.log('PULSE_ADMIN_CAP_ID='  + (adminCap?.objectId || ''));
console.log('PULSE_UPGRADE_CAP_ID='+ (upgrade?.objectId  || ''));
console.log('PULSE_TX_DIGEST='     + digest);
" 2>&1)

echo ""
echo "--- Extracted IDs ---"
echo "$EXTRACT"
echo "---------------------"

eval "$EXTRACT"

# ── Save deployed.env ─────────────────────────────────────────────────────────
cat > "$CONTRACT_DIR/deployed.env" <<EOF
PULSE_PACKAGE_ID=${PULSE_PACKAGE_ID:-}
PULSE_STATS_ID=${PULSE_STATS_ID:-}
PULSE_ADMIN_CAP_ID=${PULSE_ADMIN_CAP_ID:-}
PULSE_UPGRADE_CAP_ID=${PULSE_UPGRADE_CAP_ID:-}
PULSE_TX_DIGEST=${PULSE_TX_DIGEST:-}
DEPLOY_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DEPLOYED_BY=$ACTIVE_ADDR
EOF

echo ""
echo "✅ Saved to $CONTRACT_DIR/deployed.env"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🌊  PULSE Engine Deployed!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Add these environment secrets:"
echo "  PULSE_PACKAGE_ID    = ${PULSE_PACKAGE_ID:-<see above>}"
echo "  PULSE_STATS_ID      = ${PULSE_STATS_ID:-<see above>}"
echo "  PULSE_ADMIN_CAP_ID  = ${PULSE_ADMIN_CAP_ID:-<see above>}"
echo ""
[ -n "${PULSE_PACKAGE_ID:-}" ] && echo "  SuiScan: https://suiscan.xyz/mainnet/object/$PULSE_PACKAGE_ID"
[ -n "${PULSE_TX_DIGEST:-}"  ] && echo "  TX:      https://suiscan.xyz/mainnet/tx/$PULSE_TX_DIGEST"
echo "═══════════════════════════════════════════════════════════════"
