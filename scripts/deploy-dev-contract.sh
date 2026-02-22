#!/usr/bin/env bash
# Deploy a separate dev copy of hodlwarz_combat to Solana devnet.
#
# This creates a fresh program keypair so the dev instance gets its own
# program ID, completely isolated from production.
#
# Usage:
#   ./scripts/deploy-dev-contract.sh
#
# After deployment the script prints the new program ID. Add it to your
# .env.local (or .env.dev) as COMBAT_PROGRAM_ID=<new_id> to point your
# local game server at the dev contract.

set -euo pipefail

COMBAT_DIR="$(cd "$(dirname "$0")/../combat/hodlwarz_combat" && pwd)"
DEV_KEYPAIR="$COMBAT_DIR/dev-program-keypair.json"
PROD_PROGRAM_ID="7aeBk4C2MhuivHdBiNS44feYjwiPsg6Aiq9SEUP99TDi"

echo "=== Deploy Dev Combat Contract ==="
echo ""

# Generate a dev program keypair if one doesn't exist yet
if [ ! -f "$DEV_KEYPAIR" ]; then
  echo "Generating new dev program keypair..."
  solana-keygen new --outfile "$DEV_KEYPAIR" --no-bip39-passphrase --force
  echo ""
fi

DEV_PROGRAM_ID=$(solana-keygen pubkey "$DEV_KEYPAIR")
echo "Dev Program ID: $DEV_PROGRAM_ID"
echo "Prod Program ID: $PROD_PROGRAM_ID"
echo ""

# Temporarily swap the program ID in lib.rs for the build
LIB_RS="$COMBAT_DIR/programs/hodlwarz_combat/src/lib.rs"
echo "Patching lib.rs with dev program ID..."
sed -i.bak "s/declare_id!(\"$PROD_PROGRAM_ID\")/declare_id!(\"$DEV_PROGRAM_ID\")/" "$LIB_RS"

# Patch Anchor.toml
ANCHOR_TOML="$COMBAT_DIR/Anchor.toml"
sed -i.bak "s/$PROD_PROGRAM_ID/$DEV_PROGRAM_ID/" "$ANCHOR_TOML"

# Build
echo "Building program..."
cd "$COMBAT_DIR"
anchor build

# Deploy to devnet with the dev keypair
echo ""
echo "Deploying to devnet..."
solana program deploy \
  --program-id "$DEV_KEYPAIR" \
  --keypair "$(solana config get keypair | awk '{print $NF}')" \
  --url devnet \
  "target/deploy/hodlwarz_combat.so"

# Restore original files
echo ""
echo "Restoring production program ID in source..."
mv "$LIB_RS.bak" "$LIB_RS"
mv "$ANCHOR_TOML.bak" "$ANCHOR_TOML"

echo ""
echo "============================================"
echo "  Dev contract deployed!"
echo "  Program ID: $DEV_PROGRAM_ID"
echo ""
echo "  Add this to your .env.local:"
echo "    COMBAT_PROGRAM_ID=$DEV_PROGRAM_ID"
echo "============================================"
