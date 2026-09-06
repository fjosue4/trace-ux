#!/usr/bin/env bash
#
# Webshots installer — one script that turns a fresh Linux VPS into a running
# Webshots server: binary (dashboard + tracker are embedded), systemd service,
# and a `webshots` control command.
#
#   curl -fsSL https://raw.githubusercontent.com/fjosue4/Webshots/main/install.sh | bash
#   bash install.sh --build-from-source      # build from a local checkout instead
#   WS_PASSWORD=secret bash install.sh       # choose the admin password
#   WS_PORT=8080 bash install.sh             # choose the listen port
#
# Re-running the installer is safe: it upgrades the binary and keeps all data,
# users and the existing admin password.
set -euo pipefail

# ---- configuration (overridable via env) ------------------------------------
GITHUB_REPO="${WSSH_GITHUB_REPO:-fjosue4/Webshots}"
WS_VERSION="${WS_VERSION:-}"          # pin a release, e.g. WS_VERSION=0.2.0
WS_PORT="${WS_PORT:-8080}"
BIN_DIR="/usr/local/bin"
LIBEXEC_DIR="/usr/local/libexec/webshots"
ETC_DIR="/etc/webshots"
DATA_DIR="/var/lib/webshots"
SVC_NAME="webshots"
SVC_USER="webshots"

# ---- pretty output -----------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; OFF=""
fi
info()  { printf '%s\n' "${GREEN}==>${OFF} $*"; }
warn()  { printf '%s\n' "${YELLOW}warning:${OFF} $*" >&2; }
fail()  { printf '%s\n' "${RED}error:${OFF} $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Webshots installer

  bash install.sh                 install the latest release (systemd service + webshots CLI)
  bash install.sh --build-from-source
                                  build from the current checkout instead of a release
                                  (requires go >= 1.27 and node >= 18)
  bash install.sh --help          this help

Environment overrides:
  WS_PASSWORD=...   admin password (a random one is generated if unset)
  WS_PORT=8080      port the server listens on
  WS_VERSION=0.2.0  pin a specific release
USAGE
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --build-from-source) FROM_SOURCE=1 ;;
  "") FROM_SOURCE=0 ;;
  *) usage; fail "unknown option: $1" ;;
esac

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    fail "run as root: curl -fsSL .../install.sh | sudo bash"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch <url> <outfile>
  if have curl; then curl -fsSL "$1" -o "$2"
  elif have wget; then wget -qO "$2" "$1"
  else fail "need curl or wget to download files"
  fi
}

# ---- release download (default) ----------------------------------------------

detect_arch() {
  case "$(uname -m)" in
    x86_64)          ARCH=amd64 ;;
    aarch64|arm64)   ARCH=arm64 ;;
    *) fail "unsupported architecture: $(uname -m) (need x86_64 or aarch64)" ;;
  esac
}

install_release() {
  local base="https://github.com/${GITHUB_REPO}/releases"
  local url
  if [[ -n "$WS_VERSION" ]]; then
    url="${base}/download/v${WS_VERSION}/webshots_linux_${ARCH}.tar.gz"
  else
    url="${base}/latest/download/webshots_linux_${ARCH}.tar.gz"
  fi
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  info "downloading webshots (${ARCH})${WS_VERSION:+ v$WS_VERSION}"
  fetch "$url" "${tmp}/webshots.tar.gz"
  # Verify against the published checksums before anything touches the disk.
  if fetch "${base}/latest/download/checksums.txt" "${tmp}/checksums.txt" 2>/dev/null; then
    (cd "$tmp" && grep "webshots_linux_${ARCH}.tar.gz" checksums.txt | sha256sum -c - >/dev/null) \
      || fail "checksum mismatch — download aborted"
  else
    warn "checksums.txt not published for this release; skipping verification"
  fi
  tar -xzf "${tmp}/webshots.tar.gz" -C "$tmp"
  install -m 0755 "${tmp}/webshots" "${LIBEXEC_DIR}/webshots"
  rm -f "${LIBEXEC_DIR}/BUILT_FROM_SOURCE"
}

# ---- build from source (repo checkout) ----------------------------------------

build_from_source() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "${here}/server/main.go" ]] || fail "--build-from-source must run from a Webshots checkout"

  have go || fail "go >= 1.27 is required: https://go.dev/dl/"
  have node || fail "node >= 18 is required: https://nodejs.org/"

  info "building tracker + dashboard bundles"
  (cd "${here}/tracker"   && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
  (cd "${here}/dashboard" && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
  rm -rf "${here}/server/static/assets" "${here}/server/static/index.html"
  cp -r "${here}/dashboard/dist/." "${here}/server/static/"
  cp "${here}/tracker/dist/tracker.js" "${here}/server/static/tracker.js"

  info "compiling the server"
  mkdir -p "${LIBEXEC_DIR}"
  (cd "${here}" && CGO_ENABLED=0 go build -trimpath -o "${LIBEXEC_DIR}/webshots" ./server)
  touch "${LIBEXEC_DIR}/BUILT_FROM_SOURCE"   # makes `webshots --update` refuse politely
}

# ---- system wiring ------------------------------------------------------------

create_user() {
  if id -u "$SVC_USER" >/dev/null 2>&1; then return; fi
  info "creating system user ${SVC_USER}"
  local nologin=/usr/sbin/nologin
  [[ -x $nologin ]] || nologin=/sbin/nologin
  useradd --system --home-dir "$DATA_DIR" --shell "$nologin" "$SVC_USER"
}

write_env_file() {
  mkdir -p "$ETC_DIR"
  local env_file="${ETC_DIR}/webshots.env"
  if [[ -f $env_file ]] && grep -q '^WS_PASSWORD=' "$env_file"; then
    info "keeping existing admin password (${env_file})"
  else
    info "generating admin password (change it later: webshots --password <new>)"
    local pw
    pw="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 20)"
    printf 'WS_PASSWORD=%s\n' "$pw" > "$env_file"
  fi
  grep -q '^WS_ADDR='      "$env_file" || printf 'WS_ADDR=%s\n'      ":${WS_PORT}" >> "$env_file"
  grep -q '^WS_DATA='      "$env_file" || printf 'WS_DATA=%s\n'      "$DATA_DIR"   >> "$env_file"
  grep -q '^WS_RETENTION_DAYS=' "$env_file" || printf 'WS_RETENTION_DAYS=90\n' >> "$env_file"
  chmod 600 "$env_file"; chown root:root "$env_file"
  ENV_FILE="$env_file"
}

install_unit() {
  if ! have systemctl; then
    warn "systemd not found — install the service manually or run the binary in foreground:"
    warn "  sudo -u ${SVC_USER} WS_DATA=${DATA_DIR} ${LIBEXEC_DIR}/webshots"
    return 1
  fi
  local was_active=0
  systemctl is-active --quiet "$SVC_NAME" && was_active=1 || true
  cat > "/etc/systemd/system/${SVC_NAME}.service" <<'UNIT'
[Unit]
Description=Webshots — self-hosted session replay
Documentation=https://github.com/fjosue4/Webshots
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=webshots
Group=webshots
EnvironmentFile=/etc/webshots/webshots.env
ExecStart=/usr/local/libexec/webshots/webshots
Restart=on-failure
RestartSec=2

# Hardening: the server only ever needs its own data directory.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/webshots
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable "$SVC_NAME" >/dev/null
  # Restart on upgrades so the new binary is actually picked up.
  if ((was_active)); then
    systemctl restart "$SVC_NAME"
  else
    systemctl start "$SVC_NAME"
  fi
}

install_cli() {
  cat > "${BIN_DIR}/webshots" <<'CLI'
#!/usr/bin/env bash
# webshots control command (installed by install.sh).
# The server binary itself is /usr/local/libexec/webshots/webshots.
set -euo pipefail
SVC=webshots
ENV_FILE=/etc/webshots/webshots.env
SERVER=/usr/local/libexec/webshots/webshots

usage() {
  cat <<'H'
webshots — control the Webshots server

  webshots --start            start the service
  webshots --stop             stop the service
  webshots --restart          restart the service
  webshots --status           show service status
  webshots --logs [N]         show the last N log lines (default 100)
  webshots --password <new>   set a new admin password (min 8 chars; revokes admin logins)
  webshots --update           upgrade to the latest release (release installs only)
  webshots --run              run the server in the foreground (debugging)
  webshots --uninstall [--yes]
  webshots --version
H
}

have_systemd() { command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; }

case "${1:-}" in
  "") usage ;;
  --help|-h) usage ;;
  --version) "$SERVER" --version ;;
  --start|--stop|--restart|--status)
    have_systemd || { echo "systemd not available — run the server with: webshots --run"; exit 1; }
    systemctl "${1#--}" "$SVC"
    ;;
  --logs)
    have_systemd || { echo "systemd not available"; exit 1; }
    journalctl -u "$SVC" -n "${2:-100}" --no-pager
    ;;
  --run)
    [[ -r $ENV_FILE ]] && set -a && . "$ENV_FILE" && set +a
    exec "$SERVER"
    ;;
  --password)
    [[ -n "${2:-}" ]] || { echo "usage: webshots --password <new-password>"; exit 1; }
    [[ ${#2} -ge 8 ]] || { echo "password must be at least 8 characters"; exit 1; }
    esc="$2"
    esc="${esc//\\/\\\\}"; esc="${esc//|/\\|}"; esc="${esc//&/\\&}"
    sed -i "s|^WS_PASSWORD=.*|WS_PASSWORD=$esc|" "$ENV_FILE"
    printf 'WS_RESET_ADMIN=1\n' >> "$ENV_FILE"   # one boot re-points admin at WS_PASSWORD
    systemctl restart "$SVC"
    sleep 2
    if systemctl is-active --quiet "$SVC"; then
      sed -i '/^WS_RESET_ADMIN=/d' "$ENV_FILE"   # remove the one-shot flag again
      echo "admin password updated; previous admin logins were revoked"
    else
      echo "warning: service did not come up — check 'webshots --logs'; WS_RESET_ADMIN left in $ENV_FILE"
      exit 1
    fi
    ;;
  --update)
    if [[ -f /usr/local/libexec/webshots/BUILT_FROM_SOURCE ]]; then
      echo "this install was built from source — update with: git pull && bash install.sh --build-from-source"
      exit 1
    fi
    echo "re-running the installer to fetch the latest release (data and password are kept)..."
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL https://raw.githubusercontent.com/fjosue4/Webshots/main/install.sh | bash
    else
      wget -qO- https://raw.githubusercontent.com/fjosue4/Webshots/main/install.sh | bash
    fi
    ;;
  --uninstall)
    if [[ -t 0 && "${2:-}" != "--yes" ]]; then
      read -r -p "Remove Webshots (recordings in /var/lib/webshots are KEPT)? [y/N] " a
      [[ $a == y || $a == Y ]] || { echo "aborted"; exit 1; }
    fi
    have_systemd && systemctl disable --now "$SVC" 2>/dev/null || true
    rm -f "$SERVER" /usr/local/libexec/webshots/BUILT_FROM_SOURCE \
         /etc/systemd/system/$SVC.service "${ENV_FILE}" /usr/local/bin/webshots
    rmdir /usr/local/libexec/webshots /etc/webshots 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
    echo "removed. recordings and the database are still in /var/lib/webshots"
    ;;
  *) usage; exit 1 ;;
esac
CLI
  chmod 0755 "${BIN_DIR}/webshots"
}

# ---- main ----------------------------------------------------------------------

detect_arch
require_root

mkdir -p "$LIBEXEC_DIR" "$DATA_DIR"

if [[ ${FROM_SOURCE} -eq 1 ]]; then
  build_from_source
else
  install_release
fi

create_user
chown -R "${SVC_USER}:${SVC_USER}" "$DATA_DIR"
write_env_file
install_unit || true
install_cli

echo
info "${BOLD}Webshots is installed${OFF}"
PORT="$(grep '^WS_ADDR=' "$ENV_FILE" | cut -d= -f2 | tr -d ':')"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  dashboard : http://${IP:-localhost}:${PORT}/"
if [[ -f "$ENV_FILE" ]]; then
  echo "  login     : admin / $(grep '^WS_PASSWORD=' "$ENV_FILE" | cut -d= -f2)"
fi
echo "  data      : ${DATA_DIR}  (SQLite — back up this folder)"
echo
echo "  commands  : webshots --start | --stop | --status | --logs | --password <new>"
echo
have systemctl && systemctl is-active --quiet "$SVC_NAME" \
  && info "service is running" \
  || warn "service not running — check: webshots --logs"
echo "  next step : open the port (e.g. ufw allow ${PORT}) and put HTTPS in front (Caddy/nginx)"
