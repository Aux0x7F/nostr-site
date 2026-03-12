#!/usr/bin/env bash
set -euo pipefail

INSTALL_REPO_SLUG="${INSTALL_REPO_SLUG:-Aux0x7F/nostr-site}"
INSTALL_BRANCH="${INSTALL_BRANCH:-main}"
INSTALL_ROOT="${INSTALL_ROOT:-}"
SITE_REPO_SLUG="${SITE_REPO_SLUG:-}"
SITE_REPO_DIR="${SITE_REPO_DIR:-}"
SERVICE_NAME="${SERVICE_NAME:-nostr-site-peer-pinner}"
ROOT_ADMIN_PUBKEY="${ROOT_ADMIN_PUBKEY:-}"
SITE_DOMAIN="${SITE_DOMAIN:-}"
APP_TAG="${APP_TAG:-}"
PROTOCOL_PREFIX="${PROTOCOL_PREFIX:-}"
RELAYS="${RELAYS:-}"
PUBLISH_BOOTSTRAP=0
NON_INTERACTIVE=0
SERVICE_MODE="${SERVICE_MODE:-auto}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-repo=*) INSTALL_REPO_SLUG="${1#*=}" ;;
    --branch=*) INSTALL_BRANCH="${1#*=}" ;;
    --install-root=*) INSTALL_ROOT="${1#*=}" ;;
    --site-repo=*) SITE_REPO_SLUG="${1#*=}" ;;
    --site-repo-dir=*) SITE_REPO_DIR="${1#*=}" ;;
    --service-name=*) SERVICE_NAME="${1#*=}" ;;
    --root-admin-pubkey=*) ROOT_ADMIN_PUBKEY="${1#*=}" ;;
    --site-domain=*) SITE_DOMAIN="${1#*=}" ;;
    --app-tag=*) APP_TAG="${1#*=}" ;;
    --protocol-prefix=*) PROTOCOL_PREFIX="${1#*=}" ;;
    --relays=*) RELAYS="${1#*=}" ;;
    --service-mode=*) SERVICE_MODE="${1#*=}" ;;
    --publish-bootstrap) PUBLISH_BOOTSTRAP=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    *)
      echo "Unsupported arg: $1" >&2
      exit 1
      ;;
  esac
  shift
done

SERVICE_USER="${PINNER_RUN_USER:-${SUDO_USER:-$USER}}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
if [[ -z "$SERVICE_HOME" ]]; then
  echo "Could not resolve home directory for $SERVICE_USER" >&2
  exit 1
fi

if [[ -z "$INSTALL_ROOT" ]]; then
  INSTALL_ROOT="${SERVICE_HOME}/.local/share/nostr-site-runtime"
fi
if [[ -z "$SITE_REPO_SLUG" ]]; then
  SITE_REPO_SLUG="$INSTALL_REPO_SLUG"
fi
if [[ -z "$SITE_REPO_DIR" ]]; then
  if [[ "$SITE_REPO_SLUG" == "$INSTALL_REPO_SLUG" ]]; then
    SITE_REPO_DIR="$INSTALL_ROOT"
  else
    SITE_REPO_DIR="${INSTALL_ROOT}/site-repo"
  fi
fi

INSTALL_ROOT="$(realpath -m "$INSTALL_ROOT")"
SITE_REPO_DIR="$(realpath -m "$SITE_REPO_DIR")"
RUNTIME_PEER_PINNER_DIR="${INSTALL_ROOT}/peer-pinner"
UPDATE_SCRIPT="${INSTALL_ROOT}/update-peer-pinner.sh"

main() {
  ensure_linux
  ensure_dependencies
  ensure_github_auth
  sync_runtime_repo
  sync_site_repo
  ensure_ownership
  install_node_dependencies
  run_setup_wizard
  write_update_script
  register_service
  echo "Peer pinner host bootstrap complete"
  echo "- install root: ${INSTALL_ROOT}"
  echo "- site repo dir: ${SITE_REPO_DIR}"
  echo "- service name: ${SERVICE_NAME}"
  echo "- update helper: ${UPDATE_SCRIPT}"
}

ensure_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "host-bootstrap.sh currently targets Linux." >&2
    exit 1
  fi
}

ensure_dependencies() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required." >&2
    exit 1
  fi
  if ! command -v git >/dev/null 2>&1 || ! command -v gh >/dev/null 2>&1 || ! node_is_usable; then
    install_missing_packages
  fi
  if ! command -v npm >/dev/null 2>&1; then
    install_missing_packages
  fi
  command -v git >/dev/null 2>&1 || { echo "git is still missing after install." >&2; exit 1; }
  command -v gh >/dev/null 2>&1 || { echo "gh is still missing after install." >&2; exit 1; }
  node_is_usable || { echo "node 18+ is required." >&2; exit 1; }
  command -v npm >/dev/null 2>&1 || { echo "npm is still missing after install." >&2; exit 1; }
}

install_missing_packages() {
  local manager
  manager="$(detect_package_manager)"
  case "$manager" in
    apt)
      install_with_apt
      ;;
    dnf)
      install_with_dnf
      ;;
    yum)
      install_with_yum
      ;;
    pacman)
      install_with_pacman
      ;;
    zypper)
      install_with_zypper
      ;;
    *)
      echo "Unsupported package manager. Install git, gh, node 18+, and npm manually." >&2
      exit 1
      ;;
  esac
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo apt
  elif command -v dnf >/dev/null 2>&1; then
    echo dnf
  elif command -v yum >/dev/null 2>&1; then
    echo yum
  elif command -v pacman >/dev/null 2>&1; then
    echo pacman
  elif command -v zypper >/dev/null 2>&1; then
    echo zypper
  else
    echo unknown
  fi
}

install_with_apt() {
  run_root apt-get update
  run_root apt-get install -y ca-certificates curl git gnupg

  if ! command -v gh >/dev/null 2>&1; then
    local keyring="/usr/share/keyrings/githubcli-archive-keyring.gpg"
    local list="/etc/apt/sources.list.d/github-cli.list"
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "${TMP_DIR}/githubcli-archive-keyring.gpg"
    run_root install -m 0644 "${TMP_DIR}/githubcli-archive-keyring.gpg" "$keyring"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=${keyring}] https://cli.github.com/packages stable main" > "${TMP_DIR}/github-cli.list"
    run_root install -m 0644 "${TMP_DIR}/github-cli.list" "$list"
    run_root apt-get update
    run_root apt-get install -y gh
  fi

  if ! node_is_usable; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x -o "${TMP_DIR}/nodesource.sh"
    run_root bash "${TMP_DIR}/nodesource.sh"
    run_root apt-get install -y nodejs
  fi
}

install_with_dnf() {
  run_root dnf install -y git curl
  if ! command -v gh >/dev/null 2>&1; then
    run_root dnf install -y dnf-plugins-core || true
    run_root dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo || true
    run_root dnf install -y gh
  fi
  if ! node_is_usable || ! command -v npm >/dev/null 2>&1; then
    run_root dnf install -y nodejs npm
  fi
}

install_with_yum() {
  run_root yum install -y git curl
  if ! command -v gh >/dev/null 2>&1; then
    run_root yum install -y yum-utils || true
    run_root yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo || true
    run_root yum install -y gh
  fi
  if ! node_is_usable || ! command -v npm >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x -o "${TMP_DIR}/nodesource.sh"
    run_root bash "${TMP_DIR}/nodesource.sh"
    run_root yum install -y nodejs
  fi
}

install_with_pacman() {
  run_root pacman -Sy --noconfirm --needed git curl github-cli nodejs npm
}

install_with_zypper() {
  run_root zypper --non-interactive install git curl
  if ! command -v gh >/dev/null 2>&1; then
    run_root zypper --non-interactive install gh
  fi
  if ! node_is_usable || ! command -v npm >/dev/null 2>&1; then
    run_root zypper --non-interactive install nodejs20 npm20 || run_root zypper --non-interactive install nodejs npm
  fi
}

node_is_usable() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  (( major >= 18 ))
}

ensure_github_auth() {
  if run_as_service_user gh auth status -h github.com >/dev/null 2>&1; then
    return
  fi
  echo "GitHub CLI is not authenticated for ${SERVICE_USER}. Launching gh auth login."
  run_as_service_user gh auth login --web --git-protocol https --scopes repo
}

sync_runtime_repo() {
  prepare_repo_parent "$INSTALL_ROOT"
  if [[ -d "${INSTALL_ROOT}/.git" ]]; then
    echo "Updating runtime repo at ${INSTALL_ROOT}"
    run_as_service_user git -C "$INSTALL_ROOT" fetch origin "$INSTALL_BRANCH"
    run_as_service_user git -C "$INSTALL_ROOT" checkout "$INSTALL_BRANCH"
    run_as_service_user git -C "$INSTALL_ROOT" pull --ff-only origin "$INSTALL_BRANCH"
    return
  fi
  if [[ -d "$INSTALL_ROOT" ]] && [[ -n "$(find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "Install root ${INSTALL_ROOT} exists but is not a runtime repo checkout." >&2
    exit 1
  fi
  rm -rf "$INSTALL_ROOT"
  echo "Cloning runtime repo ${INSTALL_REPO_SLUG} into ${INSTALL_ROOT}"
  run_as_service_user gh repo clone "$INSTALL_REPO_SLUG" "$INSTALL_ROOT" -- --branch "$INSTALL_BRANCH" --single-branch
}

sync_site_repo() {
  if [[ "$SITE_REPO_DIR" == "$INSTALL_ROOT" ]]; then
    return
  fi
  prepare_repo_parent "$SITE_REPO_DIR"
  if [[ -d "${SITE_REPO_DIR}/.git" ]]; then
    echo "Updating site repo at ${SITE_REPO_DIR}"
    run_as_service_user git -C "$SITE_REPO_DIR" fetch origin "$INSTALL_BRANCH"
    run_as_service_user git -C "$SITE_REPO_DIR" checkout "$INSTALL_BRANCH"
    run_as_service_user git -C "$SITE_REPO_DIR" pull --ff-only origin "$INSTALL_BRANCH"
    return
  fi
  if [[ -d "$SITE_REPO_DIR" ]] && [[ -n "$(find "$SITE_REPO_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "Site repo dir ${SITE_REPO_DIR} exists but is not a git checkout." >&2
    exit 1
  fi
  rm -rf "$SITE_REPO_DIR"
  echo "Cloning site repo ${SITE_REPO_SLUG} into ${SITE_REPO_DIR}"
  run_as_service_user gh repo clone "$SITE_REPO_SLUG" "$SITE_REPO_DIR" -- --branch "$INSTALL_BRANCH" --single-branch
}

prepare_repo_parent() {
  local target="$1"
  local parent
  parent="$(dirname "$target")"
  mkdir -p "$parent"
  ensure_path_owned "$parent"
}

ensure_ownership() {
  ensure_path_owned "$INSTALL_ROOT"
  ensure_path_owned "$SITE_REPO_DIR"
}

ensure_path_owned() {
  local target="$1"
  mkdir -p "$target"
  if [[ "$(stat -c '%U' "$target")" != "$SERVICE_USER" ]]; then
    run_root chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "$target"
  fi
}

install_node_dependencies() {
  echo "Installing runtime dependencies"
  run_as_service_user bash -lc "cd '$INSTALL_ROOT' && npm ci && npm --prefix peer-pinner ci && npm run build:all"
}

run_setup_wizard() {
  local args=(
    "${RUNTIME_PEER_PINNER_DIR}/setup-wizard.js"
    "--repo=${SITE_REPO_SLUG}"
    "--repo-dir=${SITE_REPO_DIR}"
    "--base-branch=${INSTALL_BRANCH}"
  )
  if [[ -n "$ROOT_ADMIN_PUBKEY" ]]; then args+=("--root-admin-pubkey=${ROOT_ADMIN_PUBKEY}"); fi
  if [[ -n "$SITE_DOMAIN" ]]; then args+=("--site-domain=${SITE_DOMAIN}"); fi
  if [[ -n "$APP_TAG" ]]; then args+=("--app-tag=${APP_TAG}"); fi
  if [[ -n "$PROTOCOL_PREFIX" ]]; then args+=("--protocol-prefix=${PROTOCOL_PREFIX}"); fi
  if [[ -n "$RELAYS" ]]; then args+=("--relays=${RELAYS}"); fi
  if (( PUBLISH_BOOTSTRAP )); then args+=("--publish-bootstrap"); fi
  if (( NON_INTERACTIVE )); then args+=("--non-interactive"); fi
  echo "Running pinner setup wizard"
  run_as_service_user node "${args[@]}"
}

write_update_script() {
  {
    echo '#!/usr/bin/env bash'
    echo 'set -euo pipefail'
    printf 'exec "%s" \\\n' "${RUNTIME_PEER_PINNER_DIR}/host-bootstrap.sh"
    printf '  --install-repo="%s" \\\n' "${INSTALL_REPO_SLUG}"
    printf '  --branch="%s" \\\n' "${INSTALL_BRANCH}"
    printf '  --install-root="%s" \\\n' "${INSTALL_ROOT}"
    printf '  --site-repo="%s" \\\n' "${SITE_REPO_SLUG}"
    printf '  --site-repo-dir="%s" \\\n' "${SITE_REPO_DIR}"
    printf '  --service-name="%s"' "${SERVICE_NAME}"
    if [[ "$SERVICE_MODE" != "auto" ]]; then printf ' \\\n  --service-mode="%s"' "${SERVICE_MODE}"; fi
    if [[ -n "$ROOT_ADMIN_PUBKEY" ]]; then printf ' \\\n  --root-admin-pubkey="%s"' "${ROOT_ADMIN_PUBKEY}"; fi
    if [[ -n "$SITE_DOMAIN" ]]; then printf ' \\\n  --site-domain="%s"' "${SITE_DOMAIN}"; fi
    if [[ -n "$APP_TAG" ]]; then printf ' \\\n  --app-tag="%s"' "${APP_TAG}"; fi
    if [[ -n "$PROTOCOL_PREFIX" ]]; then printf ' \\\n  --protocol-prefix="%s"' "${PROTOCOL_PREFIX}"; fi
    if [[ -n "$RELAYS" ]]; then printf ' \\\n  --relays="%s"' "${RELAYS}"; fi
    if (( PUBLISH_BOOTSTRAP )); then printf ' \\\n  --publish-bootstrap'; fi
    if (( NON_INTERACTIVE )); then printf ' \\\n  --non-interactive'; fi
    printf '\n'
  } > "$UPDATE_SCRIPT"
  chmod +x "$UPDATE_SCRIPT"
  if [[ "$(stat -c '%U' "$UPDATE_SCRIPT")" != "$SERVICE_USER" ]]; then
    run_root chown "${SERVICE_USER}:${SERVICE_GROUP}" "$UPDATE_SCRIPT"
  fi
}

register_service() {
  case "$SERVICE_MODE" in
    auto)
      if have_root_access && command -v systemctl >/dev/null 2>&1; then
        register_system_service
      else
        register_user_service
      fi
      ;;
    system)
      register_system_service
      ;;
    user)
      register_user_service
      ;;
    *)
      echo "Unsupported service mode: ${SERVICE_MODE}" >&2
      exit 1
      ;;
  esac
}

register_system_service() {
  local unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
  echo "Registering systemd system service ${SERVICE_NAME}"
  cat > "${TMP_DIR}/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Nostr Site Peer Pinner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${RUNTIME_PEER_PINNER_DIR}
EnvironmentFile=-${RUNTIME_PEER_PINNER_DIR}/.env.peer-pinner.local
ExecStart=/usr/bin/env node ${RUNTIME_PEER_PINNER_DIR}/dist/peer-pinner.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  run_root install -m 0644 "${TMP_DIR}/${SERVICE_NAME}.service" "$unit_path"
  run_root systemctl daemon-reload
  run_root systemctl enable --now "${SERVICE_NAME}.service"
  run_root systemctl restart "${SERVICE_NAME}.service"
}

register_user_service() {
  local user_unit_dir="${SERVICE_HOME}/.config/systemd/user"
  local unit_path="${user_unit_dir}/${SERVICE_NAME}.service"
  echo "Registering systemd user service ${SERVICE_NAME}"
  mkdir -p "$user_unit_dir"
  cat > "${TMP_DIR}/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Nostr Site Peer Pinner
After=default.target

[Service]
Type=simple
WorkingDirectory=${RUNTIME_PEER_PINNER_DIR}
EnvironmentFile=-${RUNTIME_PEER_PINNER_DIR}/.env.peer-pinner.local
ExecStart=/usr/bin/env node ${RUNTIME_PEER_PINNER_DIR}/dist/peer-pinner.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  install -m 0644 "${TMP_DIR}/${SERVICE_NAME}.service" "$unit_path"
  run_as_service_user systemctl --user daemon-reload
  run_as_service_user systemctl --user enable --now "${SERVICE_NAME}.service"
  run_as_service_user systemctl --user restart "${SERVICE_NAME}.service"
  if have_root_access && command -v loginctl >/dev/null 2>&1; then
    run_root loginctl enable-linger "$SERVICE_USER" || true
  else
    echo "User service installed. If it should survive logout/reboot, enable linger for ${SERVICE_USER}."
  fi
}

have_root_access() {
  if [[ "$EUID" -eq 0 ]]; then
    return 0
  fi
  command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

run_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This action requires root privileges: $*" >&2
    exit 1
  fi
}

run_as_service_user() {
  if [[ "$(id -un)" == "$SERVICE_USER" ]]; then
    "$@"
  elif [[ "$EUID" -eq 0 ]] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$SERVICE_USER" "$@"
  else
    "$@"
  fi
}

main "$@"
