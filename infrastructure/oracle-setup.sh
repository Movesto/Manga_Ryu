#!/usr/bin/env bash
#
#  Manga Ryu — Oracle Cloud VM setup
#  ─────────────────────────────────
#  Prepares a fresh Ubuntu VM (tested on VM.Standard.E2.1.Micro, 1 GB RAM)
#  and launches the full stack behind a Cloudflare Tunnel.
#
#  Usage:
#      curl -fsSL https://raw.githubusercontent.com/Movesto/Manga_Ryu/main/infrastructure/oracle-setup.sh | bash
#
#  or from a checkout:
#      bash infrastructure/oracle-setup.sh [--no-start] [--dir PATH]
#
#  What it does (each step is idempotent — safe to re-run):
#      1. Preflight checks (OS, arch, memory, sudo)
#      2. 2 GB swap file + vm.swappiness=10
#      3. Docker Engine + Compose plugin
#      4. Container log rotation (protects the boot volume)
#      5. Repo checkout (or update) to ~/manga-ryu
#      6. .env — auto-generates secrets, prompts only for the tunnel token
#      7. Pulls images from GHCR and starts the stack
#      8. Waits for every service to report healthy
#
#  Environment overrides (for unattended runs):
#      TUNNEL_TOKEN=...   skip the interactive prompt
#      REPO_URL=...       clone a fork instead
#
set -Eeuo pipefail

# ── configuration ─────────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/Movesto/Manga_Ryu.git}"
APP_DIR="$HOME/manga-ryu"
SWAP_FILE="/swapfile"
SWAP_SIZE_MB=2048
HEALTH_TIMEOUT=420   # seconds to wait for the stack to come up
START_STACK=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) START_STACK=0 ;;
    --dir)      shift; APP_DIR="$1" ;;
    -h|--help)  grep '^#' "$0" | head -30; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

# ── output helpers ────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi
STEP=0
step() { STEP=$((STEP+1)); printf '\n%s──[%d/8]── %s%s\n' "$BOLD" "$STEP" "$1" "$RESET"; }
ok()   { printf '%s  ✔ %s%s\n' "$GREEN" "$1" "$RESET"; }
skip() { printf '%s  ↷ %s (already done)%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '%s  ⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
die()  { printf '%s  ✘ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }
trap 'printf "\n%s✘ Setup failed at line %d (step %d). Fix the issue and re-run — every step is idempotent.%s\n" "$RED" "$LINENO" "$STEP" "$RESET" >&2' ERR

# Read from the terminal even when the script is piped via curl | bash
prompt() { # prompt <message> -> $REPLY
  if [ -e /dev/tty ]; then
    read -r -p "$1" REPLY < /dev/tty
  else
    REPLY=""
  fi
}

# ── 1. preflight ──────────────────────────────────────────────────────────────
step "Preflight checks"

[ "$(id -u)" -eq 0 ] && die "Run as a regular user with sudo (e.g. 'ubuntu'), not root."
command -v sudo >/dev/null || die "sudo is required."
# Prefer a non-interactive check: on Oracle's Ubuntu image the 'ubuntu' user
# has passwordless sudo, and `sudo -v` would wrongly prompt for a password
# that was never set. Only fall back to an interactive prompt if passwordless
# sudo isn't available (i.e. the user actually has a sudo password).
if sudo -n true 2>/dev/null; then
  ok "sudo: passwordless (Oracle default)"
elif sudo -v; then
  ok "sudo: authenticated"
else
  die "sudo needs a password and none works. On Oracle's Ubuntu image the
     'ubuntu' user should have passwordless sudo — restore it from the Cloud
     Console (Instance → Console connection), then re-run this script."
fi

. /etc/os-release 2>/dev/null || die "Cannot detect OS."
case "${ID:-}" in
  ubuntu|debian) ok "OS: $PRETTY_NAME" ;;
  *) warn "Untested OS ($PRETTY_NAME) — continuing, but this targets Ubuntu." ;;
esac

ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  ok "Architecture: x86_64 (matches the GHCR images)"
elif [ "$ARCH" = "aarch64" ]; then
  warn "ARM (A1.Flex?) detected — the GHCR images are amd64-only today."
  warn "Add 'platforms: linux/amd64,linux/arm64' to the build-push CI job first."
else
  die "Unsupported architecture: $ARCH"
fi

MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$MEM_MB" -lt 1536 ]; then
  ok "Memory: ${MEM_MB} MB — tight; swap + memory caps make it work"
else
  ok "Memory: ${MEM_MB} MB"
fi

for cmd in curl git awk; do
  command -v "$cmd" >/dev/null || sudo apt-get install -y -qq "$cmd" >/dev/null
done
ok "Base tools present"

# ── 2. swap ───────────────────────────────────────────────────────────────────
step "Swap file (${SWAP_SIZE_MB} MB)"

if sudo swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  skip "swap active at $SWAP_FILE"
else
  sudo fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE" 2>/dev/null \
    || sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
  sudo chmod 600 "$SWAP_FILE"
  sudo mkswap "$SWAP_FILE" >/dev/null
  sudo swapon "$SWAP_FILE"
  ok "swap enabled"
fi
grep -q "^$SWAP_FILE " /etc/fstab || { echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null; ok "persisted in /etc/fstab"; }
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
sudo sysctl -q -p /etc/sysctl.d/99-swappiness.conf
ok "vm.swappiness=10 (swap is the safety net, not the working set)"

# ── 3. docker ─────────────────────────────────────────────────────────────────
step "Docker Engine + Compose"

if command -v docker >/dev/null; then
  skip "docker $(docker --version | awk '{print $3}' | tr -d ',')"
else
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
  ok "docker installed"
fi
docker compose version >/dev/null 2>&1 || sudo docker compose version >/dev/null 2>&1 \
  || die "Compose plugin missing — 'sudo apt-get install docker-compose-plugin'"

if id -nG "$USER" | grep -qw docker; then
  skip "$USER already in docker group"
else
  sudo usermod -aG docker "$USER"
  ok "$USER added to docker group (takes effect next login; this run uses sudo)"
fi
# Use sudo for the rest of this run so a fresh group membership isn't required
DOCKER="sudo docker"

# ── 4. log rotation ───────────────────────────────────────────────────────────
step "Container log rotation"

if [ -f /etc/docker/daemon.json ]; then
  skip "/etc/docker/daemon.json exists — not touching it"
else
  sudo mkdir -p /etc/docker
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  sudo systemctl restart docker
  ok "10 MB × 3 files per container"
fi

# ── 5. repository ─────────────────────────────────────────────────────────────
step "Repository → $APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  if git -C "$APP_DIR" pull --ff-only origin main >/dev/null 2>&1; then
    ok "updated to $(git -C "$APP_DIR" rev-parse --short HEAD)"
  else
    warn "could not fast-forward (local changes?) — keeping current checkout"
  fi
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR" >/dev/null 2>&1 || die "clone failed: $REPO_URL"
  ok "cloned $(git -C "$APP_DIR" rev-parse --short HEAD)"
fi

# ── 6. environment file ───────────────────────────────────────────────────────
step "Environment (.env)"

ENV_FILE="$APP_DIR/infrastructure/.env"
[ -f "$ENV_FILE" ] || { cp "$APP_DIR/infrastructure/.env.example" "$ENV_FILE"; ok "created from .env.example"; }
chmod 600 "$ENV_FILE"

# set_env KEY VALUE — fill KEY only if currently missing or empty
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=..*" "$ENV_FILE"; then
    return 1                                    # already set — leave it alone
  elif grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# Hex only: these values are interpolated into DATABASE_URL — base64's
# '/', '+', '=' would corrupt the URL.
set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)" && ok "POSTGRES_PASSWORD generated" || skip "POSTGRES_PASSWORD"
set_env JWT_SECRET        "$(openssl rand -hex 32)" && ok "JWT_SECRET generated"        || skip "JWT_SECRET"

if grep -q "^TUNNEL_TOKEN=..*" "$ENV_FILE"; then
  skip "TUNNEL_TOKEN"
elif [ -n "${TUNNEL_TOKEN:-}" ]; then
  set_env TUNNEL_TOKEN "$TUNNEL_TOKEN" && ok "TUNNEL_TOKEN taken from environment"
else
  echo ""
  echo "  A Cloudflare Tunnel token is required for ingress."
  echo "  Zero Trust dashboard → Networks → Tunnels → create/select tunnel →"
  echo "  copy the long token from the 'install connector' command."
  prompt "  Paste TUNNEL_TOKEN (or press Enter to fill in later): "
  if [ -n "$REPLY" ]; then
    set_env TUNNEL_TOKEN "$REPLY" && ok "TUNNEL_TOKEN saved"
  else
    warn "TUNNEL_TOKEN left empty — the stack cannot start until you set it in $ENV_FILE"
    START_STACK=0
  fi
fi

# Netdata Cloud (optional) — env override first, else an interactive prompt.
if grep -q "^NETDATA_CLAIM_TOKEN=..*" "$ENV_FILE"; then
  skip "NETDATA_CLAIM_TOKEN"
elif [ -n "${NETDATA_CLAIM_TOKEN:-}" ]; then
  set_env NETDATA_CLAIM_TOKEN "$NETDATA_CLAIM_TOKEN" && ok "NETDATA_CLAIM_TOKEN from environment"
  [ -n "${NETDATA_CLAIM_ROOMS:-}" ] && set_env NETDATA_CLAIM_ROOMS "$NETDATA_CLAIM_ROOMS"
else
  echo ""
  echo "  Optional: connect the Netdata agent to Netdata Cloud for dashboards."
  echo "  app.netdata.cloud → your Space → Connect Nodes → Docker → copy the"
  echo "  claim token and room id from the command shown."
  prompt "  Paste NETDATA_CLAIM_TOKEN (or Enter to run Netdata locally only): "
  if [ -n "$REPLY" ]; then
    set_env NETDATA_CLAIM_TOKEN "$REPLY" && ok "NETDATA_CLAIM_TOKEN saved"
    prompt "  Paste NETDATA_CLAIM_ROOMS (room id — Enter to skip): "
    [ -n "$REPLY" ] && { set_env NETDATA_CLAIM_ROOMS "$REPLY" && ok "NETDATA_CLAIM_ROOMS saved"; }
  else
    skip "Netdata Cloud (agent will run standalone — set the token later to claim)"
  fi
fi

echo ""
echo "  ${DIM}Sentry error tracking is optional — add SENTRY_DSN (backend) and"
echo "  SENTRY_DSN_FRONTEND to $ENV_FILE, then re-run the update command below.${RESET}"

# ── 7. start the stack ────────────────────────────────────────────────────────
step "Stack"

COMPOSE="$DOCKER compose -f $APP_DIR/infrastructure/docker-compose.prod.yml --env-file $ENV_FILE"

if [ "$START_STACK" -eq 0 ]; then
  warn "skipping start (--no-start or missing TUNNEL_TOKEN)"
  echo "     start later with:"
  echo "     docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml --env-file $ENV_FILE up -d"
else
  echo "  pulling images from GHCR (first pull is ~500 MB)…"
  if ! $COMPOSE pull --quiet 2>/dev/null; then
    die "Image pull failed. Make the GHCR packages public (GitHub → Packages →
     manga-ryu-backend / manga-ryu-frontend → Package settings → Change visibility)
     or 'sudo docker login ghcr.io' with a read-only PAT, then re-run."
  fi
  ok "images pulled"
  $COMPOSE up -d --quiet-pull 2>/dev/null || $COMPOSE up -d
  ok "containers started"

  # ── 8. wait for health ──────────────────────────────────────────────────────
  step "Waiting for services (up to $((HEALTH_TIMEOUT/60)) min — the JVM is slow on 1 vCPU)"
  EXPECTED=$($COMPOSE config --services 2>/dev/null | wc -l)
  DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while :; do
    # Services with a healthcheck must report 'healthy'; those without one
    # (cloudflared, netdata) only need to be running.
    UNHEALTHY=$($COMPOSE ps --format '{{.Name}} {{.Health}}' 2>/dev/null \
                 | awk '$2 != "healthy" && $2 != "" {print $1}')
    RUNNING=$($COMPOSE ps --status running -q | wc -l)
    if [ -z "$UNHEALTHY" ] && [ "$RUNNING" -ge "$EXPECTED" ]; then
      break
    fi
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      warn "timed out waiting for: ${UNHEALTHY:-containers to start}"
      echo "     inspect with: $COMPOSE ps; $COMPOSE logs --tail 50 <service>"
      break
    fi
    sleep 10
  done
  $COMPOSE ps
fi

# ── summary ───────────────────────────────────────────────────────────────────
printf '\n%s════════════════════════════════════════════════════════════════%s\n' "$BOLD" "$RESET"
printf '%s  Setup complete.%s\n' "$GREEN$BOLD" "$RESET"
cat <<EOF

  Remaining manual steps:
   1. Cloudflare Zero Trust → your tunnel → Public hostname:
        mangaryu.org  →  HTTP  →  frontend:3000
      (saving this is the DNS cutover — remove the old server's route first)
   2. Open the site and REGISTER IMMEDIATELY — the first account becomes admin.
   3. Install Suwayomi extensions, then let the initial catalog sync run
      (several hours on this shape). Watch it:
        docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml logs -f backend
   4. For auto-deploys, set the repo secrets SSH_HOST / SSH_USER / SSH_PRIVATE_KEY.
   5. Observability (optional): if you set a Netdata token, the node appears at
      app.netdata.cloud within a minute. For Sentry, add the DSNs to .env and
      re-run the update command below.

  Useful commands:
    status   docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml ps
    logs     docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml logs -f <service>
    memory   docker stats --no-stream
    update   git -C $APP_DIR pull && docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml --env-file $ENV_FILE pull && docker compose -f $APP_DIR/infrastructure/docker-compose.prod.yml --env-file $ENV_FILE up -d

  ('docker' works without sudo after you log out and back in.)
EOF
