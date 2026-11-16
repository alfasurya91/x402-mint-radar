#!/usr/bin/env bash
# Patch lib/openzeppelin-contracts Bytes.sol for pre-Cancun chains.
#
# Aevum testnet (chain 44005) is pre-Cancun: the MCOPY opcode does not exist,
# so OpenZeppelin v5.7 Bytes.sol (which uses mcopy) cannot compile for it
# (solc rejects mcopy below the Cancun EVM target).
#
# This script overwrites the submodule's Bytes.sol with the vendored
# pre-Cancun copy (contracts/vendor/Bytes.sol), fixing only the import path.
# The build itself uses the vendored copy via the foundry.toml remapping, but
# any transitive import of the submodule's Bytes.sol needs this patch too.
#
# Usage (fresh clone):
#   git submodule update --init
#   bash scripts/patch-bytes.sh
#   forge build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/contracts/vendor/Bytes.sol"
DST="$ROOT/lib/openzeppelin-contracts/contracts/utils/Bytes.sol"
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
[ -f "$DST" ] || { echo "missing $DST — run: git submodule update --init"; exit 1; }
cp "$SRC" "$DST"
# The vendored copy imports Math via the remapped path; inside the OZ tree it must be relative.
sed -i.bak 's|@openzeppelin/contracts/utils/math/Math.sol|./math/Math.sol|' "$DST"
rm -f "$DST.bak"
if grep -q "mcopy" "$DST"; then echo "patch FAILED: mcopy still present in $DST"; exit 1; fi
echo "patched $DST (pre-Cancun, no mcopy)"
