#!/usr/bin/env bash
#
#  Manga Ryu — Oracle Cloud VM setup
#  ─────────────────────────────────
#  Prepares a fresh Ubuntu VM (tested on VM.Standard.E2.1.Micro, 1 GB RAM)
#  and brings up the full stack. Images are BUILT ON THE VM from this repo —
#  no container registry, no login, no external image auth. Ingress is a
#  Cloudflare Tunnel, so no inbound ports are opened.
#
#  Run it from inside a checkout of the repo:
#      cd ~/manga-ryu && bash infrastructure/oracle-setup.sh
#
#  Or one-shot on a bare VM:
#      sudo apt-get update && sudo apt-get install -y git \
#        && git clone https://github.com/Movesto/Manga_Ryu.git ~/manga-ryu \
#        && bash ~/manga-ryu/infrastructure/oracle-setup.sh
#
#  Re-running is safe — every step is idempotent. To ship new code later:
#      cd ~/manga-ryu && git pull && bash infrastructure/oracle-setup.sh
#
#  Flags:
#      --no-start   set everything up but don't build/launch
#  Env overrides (skip the prompts, for unattended runs):
#      TUNNEL_TOKEN=...   NETDATA_CLAIM_TOKEN=...   NETDATA_CLAIM_ROOMS=...
#
set -Eeuo pipefail

# ── locate the repo (script lives in <repo>/infrastructure) ───────────────────
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$INFRA_DIR")"
COMPOSE_FILE="$INFRA_DIR/docker-compose.prod.yml"
ENV_FILE="$INFRA_DIR/.env"
SWAP_FILE="/swapfile"
SWAP_SIZE_MB=2048
HEALTH_TIMEOUT=600      # builds + JVM startup are slow on 1 vCPU
START=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-start) START=0 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -32; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

# ── pretty output ─────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; X=$'\033[0m'
else B=""; G=""; Y=""; R=""; D=""; X=""; fi
N=0
step() { N=$((N+1)); printf '\n%s──[%d/7]── %s%s\n' "$B" "$N" "$1" "$X"; }
ok()   { printf '%s  ✔ %s%s\n' "$G" "$1" "$X"; }
skip() { printf '%s  ↷ %s%s\n' "$D" "$1" "$X"; }
warn() { printf '%s  ⚠ %s%s\n' "$Y" "$1" "$X"; }
die()  { printf '%s  ✘ %s%s\n' "$R" "$1" "$X" >&2; exit 1; }
trap 'printf "\n%s✘ Failed at line %d (step %d). Fix it and re-run — steps are idempotent.%s\n" "$R" "$LINENO" "$N" "$X" >&2' ERR

# read from the terminal even under `curl | bash`
ask() { if [ -e /dev/tty ]; then read -r -p "$1" REPLY < /dev/tty; else REPLY=""; fi; }

# ── 1. preflight ──────────────────────────────────────────────────────────────
step "Preflight"
[ "$(id -u)" -eq 0 ] && die "Run as a normal user with sudo (e.g. 'ubuntu'), not root."
command -v sudo >/dev/null || die "sudo is required."
# Non-interactive check first: Oracle's 'ubuntu' user has passwordless sudo and
# `sudo -v` would wrongly prompt for a password that was never set.
if sudo -n true 2>/dev/null; then ok "sudo: passwordless"
elif sudo -v; then ok "sudo: authenticated"
else die "sudo needs a password. Restore passwordless sudo from the Oracle Console, then re-run."; fi

. /etc/os-release 2>/dev/null || die "cannot detect OS"
case "${ID:-}" in ubuntu|debian) ok "OS: $PRETTY_NAME" ;; *) warn "Untested OS ($PRETTY_NAME) — targets Ubuntu" ;; esac
[ "$(uname -m)" = "x86_64" ] || warn "Arch $(uname -m) — the E2.1.Micro is x86_64; images build for the host arch anyway"
MEM=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo); ok "Memory: ${MEM} MB"
[ -f "$COMPOSE_FILE" ] || die "compose file not found at $COMPOSE_FILE — run from a repo checkout"

# ── 2. swap ───────────────────────────────────────────────────────────────────
step "Swap (${SWAP_SIZE_MB} MB — needed to build the frontend on 1 GB RAM)"
if sudo swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAP_FILE"; then
  skip "swap already active"
else
  sudo fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE" 2>/dev/null \
    || sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
  sudo chmod 600 "$SWAP_FILE"; sudo mkswap "$SWAP_FILE" >/dev/null; sudo swapon "$SWAP_FILE"; ok "swap on"
fi
grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null && sudo sysctl -q -p /etc/sysctl.d/99-swap.conf
ok "vm.swappiness=10"

# ── 3. docker ─────────────────────────────────────────────────────────────────
step "Docker + Compose"
if command -v docker >/dev/null; then skip "docker $(docker --version | awk '{print $3}' | tr -d ,)"
else curl -fsSL https://get.docker.com | sudo sh >/dev/null; ok "docker installed"; fi
sudo docker compose version >/dev/null 2>&1 || die "compose plugin missing"
id -nG "$USER" | grep -qw docker || { sudo usermod -aG docker "$USER"; ok "added $USER to docker group (effective next login)"; }
DC="sudo docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"

# ── 4. log rotation (protect the boot volume) ─────────────────────────────────
step "Container log rotation"
if [ -f /etc/docker/daemon.json ]; then skip "/etc/docker/daemon.json exists — leaving it"
else
  sudo mkdir -p /etc/docker
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker; ok "10 MB × 3 per container"
fi

# ── 5. .env (generate secrets, prompt only for tokens) ────────────────────────
step "Environment (.env)"
[ -f "$ENV_FILE" ] || { cp "$INFRA_DIR/.env.example" "$ENV_FILE"; ok "created from .env.example"; }
chmod 600 "$ENV_FILE"
# fill KEY only if blank/missing; return 1 if it was already set
set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=..*" "$ENV_FILE"; then return 1
  elif grep -q "^${k}=" "$ENV_FILE"; then sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"; fi
}
# hex only — these get interpolated into DATABASE_URL
set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)" && ok "POSTGRES_PASSWORD generated" || skip "POSTGRES_PASSWORD kept"
set_env JWT_SECRET        "$(openssl rand -hex 32)" && ok "JWT_SECRET generated"        || skip "JWT_SECRET kept"

if grep -q "^TUNNEL_TOKEN=..*" "$ENV_FILE"; then skip "TUNNEL_TOKEN kept"
elif [ -n "${TUNNEL_TOKEN:-}" ]; then set_env TUNNEL_TOKEN "$TUNNEL_TOKEN" && ok "TUNNEL_TOKEN from env"
else
  echo "  Cloudflare Tunnel token (Zero Trust → Networks → Tunnels → your tunnel"
  echo "  → the token in the 'install connector' command):"
  ask "  Paste TUNNEL_TOKEN (Enter to set later): "
  if [ -n "$REPLY" ]; then set_env TUNNEL_TOKEN "$REPLY" && ok "TUNNEL_TOKEN saved"
  else warn "TUNNEL_TOKEN empty — the stack won't start until it's set in $ENV_FILE"; START=0; fi
fi

if grep -q "^NETDATA_CLAIM_TOKEN=..*" "$ENV_FILE"; then skip "NETDATA_CLAIM_TOKEN kept"
elif [ -n "${NETDATA_CLAIM_TOKEN:-}" ]; then
  set_env NETDATA_CLAIM_TOKEN "$NETDATA_CLAIM_TOKEN" && ok "NETDATA_CLAIM_TOKEN from env"
  [ -n "${NETDATA_CLAIM_ROOMS:-}" ] && set_env NETDATA_CLAIM_ROOMS "$NETDATA_CLAIM_ROOMS"
else
  echo "  Optional — Netdata Cloud metrics (app.netdata.cloud → Connect Nodes → Docker):"
  ask "  Paste NETDATA_CLAIM_TOKEN (Enter to skip): "
  if [ -n "$REPLY" ]; then
    set_env NETDATA_CLAIM_TOKEN "$REPLY" && ok "NETDATA_CLAIM_TOKEN saved"
    ask "  Paste NETDATA_CLAIM_ROOMS (Enter to skip): "; [ -n "$REPLY" ] && set_env NETDATA_CLAIM_ROOMS "$REPLY"
  else skip "Netdata runs standalone (set the token later to claim it)"; fi
fi
printf '  %sSentry error tracking is optional — add SENTRY_DSN / SENTRY_DSN_FRONTEND to %s later.%s\n' "$D" "$ENV_FILE" "$X"

# ── 6. build the images on this VM ────────────────────────────────────────────
step "Build backend + frontend (a few minutes on 1 vCPU — swap does the heavy lifting)"
if [ "$START" -eq 0 ]; then
  warn "skipping build/start (--no-start or missing TUNNEL_TOKEN)"
  echo "     later: cd $INFRA_DIR && sudo docker compose -f $COMPOSE_FILE --env-file .env up -d --build"
  exit 0
fi
$DC build backend frontend
ok "images built (manga-ryu-backend:local, manga-ryu-frontend:local)"

# ── 7. start + wait for health ────────────────────────────────────────────────
step "Start stack + wait for health (up to $((HEALTH_TIMEOUT/60)) min)"
$DC up -d
EXPECTED=$($DC config --services 2>/dev/null | wc -l)
DEADLINE=$(( $(date +%s) + HEALTH_TIMEOUT ))
while :; do
  # services with a healthcheck must be 'healthy'; the rest (cloudflared,
  # netdata) just need to be running
  UNHEALTHY=$($DC ps --format '{{.Name}} {{.Health}}' 2>/dev/null | awk '$2!="healthy" && $2!="" {print $1}')
  RUNNING=$($DC ps --status running -q | wc -l)
  { [ -z "$UNHEALTHY" ] && [ "$RUNNING" -ge "$EXPECTED" ]; } && break
  [ "$(date +%s)" -ge "$DEADLINE" ] && { warn "timed out waiting for: ${UNHEALTHY:-startup}"; break; }
  sleep 10
done
$DC ps

# ── done ──────────────────────────────────────────────────────────────────────
printf '\n%s════════════════════════════════════════════════════════════════%s\n' "$B" "$X"
printf '%s  Done.%s\n' "$G$B" "$X"
cat <<EOF

  Next:
   1. Cloudflare Zero Trust → your tunnel → Public hostname:
        mangaryu.org  →  HTTP  →  frontend:3000
      (saving it is the DNS cutover — remove the old server's route first)
   2. Open the site and REGISTER — the first account becomes admin.
   3. Install Suwayomi sources, then let the initial sync run (a few hours here).

  Handy:
    status   sudo docker compose -f $COMPOSE_FILE ps
    logs     sudo docker compose -f $COMPOSE_FILE logs -f backend
    memory   sudo docker stats --no-stream
    redeploy cd $APP_DIR && git pull && bash infrastructure/oracle-setup.sh

  (Log out and back in once, then 'docker' works without sudo.)
EOF
