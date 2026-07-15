# Deploying Manga Ryu to Oracle Cloud (VM.Standard.E2.1.Micro)

Runbook for moving the stack from the local server to an Always Free Oracle
Cloud VM. Target shape: **VM.Standard.E2.1.Micro — 1 OCPU (x86), 1 GB RAM**.
Ingress is a **Cloudflare Tunnel** (outbound-only), so no Oracle security-list
or iptables changes are needed at all.

> **1 GB RAM is tight.** The stack fits because: images are built without the
> ML tagger (torch alone exceeds the whole VM), every container has a memory
> cap, Suwayomi's JVM heap is bounded to 384 MB, and the setup script creates
> a 2 GB swap file. If **VM.Standard.A1.Flex** capacity opens up in your
> region (4 OCPU / 24 GB, also free), prefer it — the same compose file works;
> you'd only need arm64 images (add `platforms: linux/amd64,linux/arm64` to
> the build-push job).

---

## 1. Create the instance

- **Image:** Ubuntu 24.04 (Canonical, minimal is fine)
- **Shape:** VM.Standard.E2.1.Micro
- **Boot volume:** default 47 GB
- **SSH key:** add your public key
- Networking defaults are fine — the tunnel needs **no inbound ports**.
  (Leave port 22 open in the security list for SSH admin access.)

## 2. Bootstrap the VM

Get the tunnel token first (step 3), SSH in as `ubuntu`, then:

```bash
curl -fsSL https://raw.githubusercontent.com/Movesto/Manga_Ryu/main/infrastructure/oracle-setup.sh | bash
```

The script is idempotent (safe to re-run) and does everything: 2 GB swap,
Docker + Compose, container log rotation, repo checkout to `~/manga-ryu`,
`.env` with **auto-generated** `POSTGRES_PASSWORD` and `JWT_SECRET`, a prompt
for the `TUNNEL_TOKEN`, then pulls the GHCR images, starts the stack, and
waits for every service to report healthy.

Unattended run (no prompt):

```bash
TUNNEL_TOKEN=eyJh... bash oracle-setup.sh        # or --no-start to skip launch
```

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

The setup script already pulled and started the stack. Prerequisite: the
images must exist on GHCR — they are pushed by the security pipeline on every
push to `main` (make the two packages **public** in GitHub → Packages →
package settings, or `docker login ghcr.io` on the VM with a read-only PAT).

To start/inspect manually:

```bash
cd ~/manga-ryu/infrastructure
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps        # wait for healthy
docker compose -f docker-compose.prod.yml logs -f backend
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

## 5. CI/CD

Update the three repo secrets and pushes to `main` deploy automatically
(after all security jobs pass):

| Secret | Value |
|---|---|
| `SSH_HOST` | VM public IP |
| `SSH_USER` | `ubuntu` |
| `SSH_PRIVATE_KEY` | key matching the VM's `authorized_keys` |

The pipeline now pushes the **scanned** images to GHCR
(`manga-ryu-backend` / `manga-ryu-frontend`) and the deploy job runs
`docker compose pull && up -d` on the VM.

## 6. Decommission the Optiplex

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
| cloudflared | 64 MB | |
| **total caps** | ~1.2 GB | vs 1 GB RAM + 2 GB swap — peaks spill to swap |

**Do not** mount an ML model or set `TAGGER_MODEL_DIR` on this shape: the
GHCR backend image has no torch, and installing it would not fit anyway. Run
tagging offline (see `ml/`) against the database if needed, from another
machine.

## Known limitations on this shape

- Initial catalog sync and the 6-hourly re-sync are slow and CPU-bound.
- PDF/EPUB export jobs (Pillow image work) will be sluggish; the 5/min rate
  limit matters here.
- If the VM OOMs anyway, check `docker stats` and trim `-Xmx` first — the JVM
  is always the biggest tenant.
