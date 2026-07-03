#!/usr/bin/env bash
# bootstrap.sh — set up the vendored WeChat decrypt toolchain for wechat-radar.
#
# Creates a local Python venv, installs pinned deps, and compiles the two macOS
# memory key scanners from source (arch-specific — never ship the binary).
#
# Usage:
#   scripts/decrypt/bootstrap.sh
#
# Idempotent: re-running upgrades deps and recompiles the scanners.
# Produces (all gitignored):
#   scripts/decrypt/.venv/                        Python venv
#   scripts/decrypt/decrypt/find_all_keys_macos   compiled personal-WeChat scanner
#   scripts/decrypt/decrypt/find_wecom_keys_macos compiled Enterprise-WeChat scanner
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
PY="${PYTHON_BIN:-python3}"

echo "==> Python venv: $VENV"
if [ ! -d "$VENV" ]; then
  "$PY" -m venv "$VENV"
fi
# shellcheck disable=SC1091
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
echo "    deps installed: $("$VENV/bin/pip" freeze | tr '\n' ' ')"

echo "==> Compiling macOS key scanners (arch: $(uname -m))"
if [ "$(uname -s)" = "Darwin" ]; then
  cc -O2 -o "$HERE/decrypt/find_all_keys_macos" \
     "$HERE/decrypt/find_all_keys_macos.c" -framework Foundation
  echo "    built find_all_keys_macos"
  cc -O2 -Wall -Wextra -o "$HERE/decrypt/find_wecom_keys_macos" \
     "$HERE/decrypt/find_wecom_keys_macos.c"
  echo "    built find_wecom_keys_macos"
else
  echo "    [skip] not macOS — key scanners are macOS-only in this vendor set."
fi

echo "==> Done. venv python: $VENV/bin/python"
echo "    Set WECHAT_RADAR_DECRYPT_PYTHON=$VENV/bin/python (or let lib/decrypt.ts auto-detect)."
