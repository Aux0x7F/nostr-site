#!/usr/bin/env bash
set -euo pipefail

RAW_BASE="${NOSTR_SITE_RAW_BASE:-https://raw.githubusercontent.com/Aux0x7F/nostr-site/main/peer-pinner}"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

case "$(uname -s)" in
  Linux*)
    curl -fsSL "${RAW_BASE}/host-bootstrap.sh" -o "${TMP_DIR}/host-bootstrap.sh"
    chmod +x "${TMP_DIR}/host-bootstrap.sh"
    exec bash "${TMP_DIR}/host-bootstrap.sh" "$@"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    if command -v pwsh.exe >/dev/null 2>&1; then
      PS_BIN="pwsh.exe"
    elif command -v powershell.exe >/dev/null 2>&1; then
      PS_BIN="powershell.exe"
    elif command -v pwsh >/dev/null 2>&1; then
      PS_BIN="pwsh"
    else
      echo "PowerShell was not found." >&2
      exit 1
    fi
    curl -fsSL "${RAW_BASE}/host-bootstrap.ps1" -o "${TMP_DIR}/host-bootstrap.ps1"
    exec "$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "${TMP_DIR}/host-bootstrap.ps1" "$@"
    ;;
  *)
    echo "Unsupported host OS: $(uname -s)" >&2
    exit 1
    ;;
esac
