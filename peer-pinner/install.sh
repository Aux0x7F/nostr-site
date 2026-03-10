#!/usr/bin/env bash
set -euo pipefail

RAW_BASE="${NOSTR_SITE_RAW_BASE:-https://raw.githubusercontent.com/Aux0x7F/nostr-site/main/peer-pinner}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if command -v pwsh.exe >/dev/null 2>&1; then
  PS_BIN="pwsh.exe"
elif command -v powershell.exe >/dev/null 2>&1; then
  PS_BIN="powershell.exe"
elif command -v pwsh >/dev/null 2>&1; then
  PS_BIN="pwsh"
else
  echo "PowerShell was not found. This bootstrap path currently targets Windows hosts." >&2
  exit 1
fi

curl -fsSL "${RAW_BASE}/host-bootstrap.ps1" -o "${TMP_DIR}/host-bootstrap.ps1"
exec "$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "${TMP_DIR}/host-bootstrap.ps1" "$@"
