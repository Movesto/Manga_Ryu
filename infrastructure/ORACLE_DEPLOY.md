# Deploying Manga Ryu to Oracle Cloud (VM.Standard.E2.1.Micro)

Runbook for moving the stack from the local server to an Always Free Oracle
Cloud VM. Target shape: **VM.Standard.E2.1.Micro — 1 OCPU (x86), 1 GB RAM**.
Ingress is a **Cloudflare Tunnel** (outbound-only), so no Oracle security-list
or iptables changes are needed at all.

The backend and frontend images are **built on the VM** from this repo — no
container registry, no image auth, nothing to log into. The other images
(Suwayomi, Postgres, Netdata, cloudflared) are public.

> **1 GB RAM is tight.** The stack fits because: the backend is built without
> the ML tagger (torch alone exceeds the whole VM), every container has a
> memory cap, Suwayomi's JVM heap is bounded to 384 MB, and the setup script
> creates a 2 GB swap file (which also covers the frontend build). If
> **VM.Standard.A1.Flex** capacity opens up in your region (4 OCPU / 24 GB,
> also free), prefer it — the same compose file works as-is.

---

## 1. Create the instance

- **Image:** Ubuntu 24.04 (Canonical, minimal is fine)
- **Shape:** VM.Standard.E2.1.Micro
- **Boot volume:** default 47 GB
- **SSH key:** add your public key
- Networking defaults are fine — the tunnel needs **no inbound ports**.
  (Leave port 22 open in the security list for SSH admin access.)

## 2. Bootstrap the VM

Get the tunnel token first (step 3), SSH in as `ubuntu`, then clone the repo
and run the setup script (it builds the images from the checkout, so it must
run from inside the repo — don't pipe it via `curl`):

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/Movesto/Manga_Ryu.git ~/manga-ryu
bash ~/manga-ryu/infrastructure/oracle-setup.sh
```

The script is idempotent (safe to re-run) and does everything: 2 GB swap,
Docker + Compose, container log rotation, `.env` with **auto-generated**
`POSTGRES_PASSWORD` and `JWT_SECRET`, a prompt for the `TUNNEL_TOKEN` (and
optionally Netdata), then **builds** the backend + frontend images on the VM,
starts the stack, and waits for every service to report healthy.

Unattended run (no prompts):

```bash
TUNNEL_TOKEN=eyJh... bash ~/manga-ryu/infrastructure/oracle-setup.sh   # or --no-start

## 3. Cloudflare Tunnel

In **Cloudflare Zero Trust → Networks → Tunnels**:

1. Create a tunnel (or reuse the existing `mangaryu.org` one), connector type
   *Cloudflared*. Copy the token from the install command into `TUNNEL_TOKEN`.
2. Add a **public hostname**: `mangaryu.org` → service `HTTP` →
   `frontend:3000`. (The `cloudflared` container shares a Docker network with
   the frontend, so the service name resolves.)

DNS cutover happens the moment the public hostname is saved — if the old
tunnel on the Optiplex still owns that hostname, delete its route first.

## 4. First start

The setup script already built the images and started the stack. To
build/start/inspect manually:

```bash
cd ~/manga-ryu/infrastructure
sudo docker compose -f docker-compose.prod.yml --env-file .env up -d --build
sudo docker compose -f docker-compose.prod.yml ps        # wait for healthy
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

**Fresh-start behavior:** the backend sees an empty `manga` table and kicks
off a full sync of all Suwayomi sources in the background. On this shape
expect it to take **several hours** with sustained CPU — install your Suwayomi
extensions first (see below) or the sync finds no sources. Register the first
account promptly: **the first registered user becomes admin**.

Suwayomi ships with no sources; install extensions through the backend once,
or temporarily port-forward the Suwayomi UI over SSH:

```bash
ssh -L 4567:localhost:4567 ubuntu@<vm-ip>   # then on the VM:
docker compose -f docker-compose.prod.yml exec suwayomi true  # (container is on the internal network)
# simplest: docker run --rm --network infrastructure_internal -p 127.0.0.1:4567:4567 alpine/socat \
#   tcp-listen:4567,fork,reuseaddr tcp-connect:suwayomi:4567
# then browse http://localhost:4567 through the SSH tunnel and install extensions
```

## 5. Shipping new code

Deployment is **not** automated from CI (no registry to push to, no inbound
SSH to open). To ship an update, pull and re-run the setup script on the VM —
it rebuilds only what changed and restarts:

```bash
ssh ubuntu@<vm-ip> 'cd ~/manga-ryu && git pull && bash infrastructure/oracle-setup.sh'
```

CI (`.github/workflows/security.yml` + `ci.yml`) still runs on every push as a
**quality gate** — Gitleaks, Semgrep, pip-audit, npm audit, Trivy (it builds
and scans the same slim images), plus lint/typecheck/tests. Keep those green
before you deploy.

If you later want fully hands-off deploys without opening a port, add a
`Watchtower`-style poller or a cron `git pull && … up -d --build` on the VM —
both are outbound-only and fit the tunnel design.

## 6. Observability (Sentry + Netdata)

Both are opt-in and off until you add keys to `.env`.

**Sentry** (error tracking): create one or two projects on sentry.io, then set
in `.env`:

```bash
SENTRY_DSN=            # backend / FastAPI project DSN
SENTRY_DSN_FRONTEND=   # frontend project DSN (reaches the browser; DSNs are public)
```

The backend SDK auto-instruments FastAPI; the frontend reports both SSR
(node) and browser errors. The browser SDK chunk is lazy-loaded only when a
DSN is present, and the CSP's `connect-src` automatically allows the Sentry
ingest host. Apply with the update command (bottom of this doc).

**Netdata** (metrics): the `oracle-setup.sh` script prompts for the claim
token. To do it later, set in `.env`:

```bash
NETDATA_CLAIM_TOKEN=   # app.netdata.cloud → Space → Connect Nodes → Docker
NETDATA_CLAIM_ROOMS=   # room id from the same command
```

then `docker compose … up -d netdata`. The node shows up in Netdata Cloud
within a minute. Without a token the agent still runs standalone — reach its
dashboard with `ssh -L 19999:localhost:19999 ubuntu@<vm-ip>` after temporarily
exposing the port, or add a tunnel hostname. The agent is tuned lean in
`infrastructure/netdata/netdata.conf` (ML/eBPF/apps collectors off, RAM-only
history) because Netdata Cloud holds the long-term data.

## 7. Decommission the Optiplex

Once mangaryu.org serves from the VM:

- stop/disable `mangaryu-backend.service` and `mangaryu-frontend.service`
- remove the old tunnel connector (or the whole tunnel if you made a new one)
- keep a final `pg_dump` of the old database as a keepsake backup before
  wiping — fresh start was chosen, but the dump costs nothing to keep

## Memory budget (why these limits)

| Service | Cap | Notes |
|---|---|---|
| suwayomi | 512 MB | JVM, `-Xmx384m -XX:+UseSerialGC` |
| backend | 256 MB | no torch (INSTALL_ML=false image) |
| frontend | 192 MB | node SSR |
| postgres | 160 MB | `shared_buffers=32MB`, `max_connections=40` |
| netdata | 150 MB | lean agent, ML/eBPF off, RAM-only history |
| cloudflared | 64 MB | |
| **total caps** | ~1.3 GB | vs 1 GB RAM + 2 GB swap — idle set fits RAM, peaks spill to swap |

Netdata is the one genuinely optional tenant here. If the box feels starved,
either drop its `mem_limit`/history further or comment the service out — the
rest of the stack doesn't depend on it.

**Do not** mount an ML model or set `TAGGER_MODEL_DIR` on this shape: the
backend image is built with `INSTALL_ML=false` (no torch), and installing it
would not fit anyway. Run tagging offline (see `ml/`) against the database
from another machine if needed.

## Known limitations on this shape

- Initial catalog sync and the 6-hourly re-sync are slow and CPU-bound.
- PDF/EPUB export jobs (Pillow image work) will be sluggish; the 5/min rate
  limit matters here.
- If the VM OOMs anyway, check `docker stats` and trim `-Xmx` first — the JVM
  is always the biggest tenant.
