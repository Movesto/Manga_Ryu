#!/usr/bin/env bash
# One-time setup for the Oracle Cloud VM (Ubuntu 22.04/24.04 minimal image).
# Prepares a 1 GB VM.Standard.E2.1.Micro to run the Manga Ryu stack:
#   swap file, Docker Engine + Compose, repo checkout, log rotation.
#
# Usage (as the default 'ubuntu' user):
#   curl -fsSL https://raw.githubusercontent.com/Movesto/Manga_Ryu/main/infrastructure/oracle-setup.sh | bash
# or copy the repo over and run: bash infrastructure/oracle-setup.sh
set -euo pipefail

REPO_URL="https://github.com/Movesto/Manga_Ryu.git"
APP_DIR="$HOME/manga-ryu"
SWAP_FILE="/swapfile"
SWAP_SIZE_MB=2048

echo "── 1/5 Swap file (${SWAP_SIZE_MB} MB) ─────────────────────────────────"
if ! sudo swapon --show | grep -q "$SWAP_FILE"; then
  sudo fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE"
  sudo chmod 600 "$SWAP_FILE"
  sudo mkswap "$SWAP_FILE"
  sudo swapon "$SWAP_FILE"
  grep -q "$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab
  # Prefer RAM; swap is the safety net, not the working set
  echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swappiness.conf
  sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
else
  echo "swap already active — skipping"
fi

echo "── 2/5 Docker Engine + Compose plugin ─────────────────────────────────"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
else
  echo "docker already installed — skipping"
fi

echo "── 3/5 Container log rotation (protect the 47 GB boot volume) ────────"
sudo mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  sudo systemctl restart docker
fi

echo "── 4/5 Repository checkout ────────────────────────────────────────────"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "repo already cloned — skipping"
fi

echo "── 5/5 Environment file ───────────────────────────────────────────────"
ENV_FILE="$APP_DIR/infrastructure/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/infrastructure/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo ""
  echo "  Created $ENV_FILE — EDIT IT NOW and set:"
  echo "    POSTGRES_PASSWORD  (openssl rand -base64 32)"
  echo "    JWT_SECRET         (openssl rand -hex 32)"
  echo "    TUNNEL_TOKEN       (Cloudflare Zero Trust → Tunnels → your tunnel)"
else
  echo ".env already exists — skipping"
fi

echo ""
echo "Done. Next steps:"
echo "  1. Log out and back in (docker group membership)."
echo "  2. Edit $ENV_FILE (see above)."
echo "  3. cd $APP_DIR/infrastructure"
echo "     docker compose -f docker-compose.prod.yml --env-file .env up -d"
echo "  4. In Cloudflare Zero Trust, point the tunnel's public hostname at"
echo "     http://frontend:3000"
