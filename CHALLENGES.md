# Manga Ryu — DevSecOps Challenge Track

A hands-on learning track built around a real production application.
Completing this track prepares you for **Application Security Engineer** and **DevOps/DevSecOps Engineer** roles.

Each challenge names the tools that appear in real job postings and includes a resume bullet to use once complete.

---

## How to use this track

Two career paths are available. Do the **Foundation** first (challenges 1–5), then follow your target path. The Advanced section is for when you want senior-level differentiation.

| Path | Focus Challenges |
|------|-----------------|
| **AppSec Engineer** | Foundation + AppSec Track (6–11) + Advanced (20–22) |
| **DevOps / DevSecOps** | Foundation + DevOps Track (12–17) + Advanced (18–22) |
| **Full DevSecOps** | All challenges |

---

## Foundation — Security Fundamentals
*Do these first. They apply to both career paths and fix real vulnerabilities in the live app.*

---

### Challenge 1 — Secrets Management + Git History Scanning

**The problem:** `backend/auth.py:26-28` generates a random `JWT_SECRET` on each startup — sessions die on restart. There's also no guarantee secrets haven't already been committed to git history.

**Tasks:**
- Scan the entire git history for leaked secrets using **Gitleaks** (`gitleaks detect --source . --verbose`)
- If any are found, rotate them and document what you found
- Enforce `JWT_SECRET` as a required env var — crash on startup if it's missing
- Create `.env.example` documenting every env var the app needs
- Add `backend/requirements.txt` with pinned versions

**Key tools:** Gitleaks, TruffleHog (alternative)

**Resume Bullet:**
> Audited a production application's git history for credential exposure using Gitleaks, remediated secrets management by enforcing required environment variables, and established reproducible dependency pinning

---

### Challenge 2 — Threat Modeling (STRIDE)

**The problem:** No threat model exists. Security decisions are reactive. This is the first thing AppSec teams do on a new application.

**Tasks:**
- Draw a Data Flow Diagram (DFD) for Manga Ryu: browser → Nginx → React → FastAPI → PostgreSQL/Suwayomi
- Apply the **STRIDE** framework to identify threats at each trust boundary (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
- Document at least 8 threats with: threat description, affected component, likelihood, impact, and mitigation
- Save it as `THREAT_MODEL.md` in the repo

**Key tools:** STRIDE, OWASP Threat Dragon (optional diagramming tool), Microsoft Threat Modeling Tool

**Resume Bullet:**
> Authored a STRIDE threat model for a full-stack web application, identifying and prioritizing security risks across all trust boundaries with documented mitigations — establishing a baseline for ongoing secure SDLC

---

### Challenge 3 — Security Headers

**The problem:** The app sends no security headers. Verified: `curl -I https://mangaryu.org/api/health` — no CSP, no HSTS, no X-Frame-Options.

**Tasks:**
- Add a FastAPI middleware to `backend/main.py` that injects:
  - `Content-Security-Policy` (start restrictive, adjust as needed)
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- Run the live site through **Mozilla Observatory** (`observatory.mozilla.org`) — target an A or A+ rating

**Key tools:** Mozilla Observatory, SecurityHeaders.com

**Resume Bullet:**
> Hardened a production web application against XSS, clickjacking, and MIME-sniffing by implementing a security headers middleware, achieving an A+ rating on Mozilla Observatory

---

### Challenge 4 — CSRF Protection

**The problem:** The API uses HttpOnly cookies. Any malicious site can silently trigger `POST /api/sync` or `POST /api/bookmarks/{id}` from a logged-in victim's browser — a textbook CSRF attack.

**Tasks:**
- Implement the **Double Submit Cookie** pattern: generate a CSRF token, set it in a readable cookie and require it in a request header (`X-CSRF-Token`)
- Update all state-mutating frontend fetch calls to include the header
- Write a short threat model rationale in `SECURITY.md` explaining why this mitigates the attack

**Key tools:** OWASP CSRF Prevention Cheat Sheet

**Resume Bullet:**
> Remediated a CSRF vulnerability in a cookie-authenticated REST API by implementing the Double Submit Cookie pattern, with a documented threat model and frontend integration across all mutating API calls

---

### Challenge 5 — API Rate Limiting & Abuse Prevention

**The problem:** Only `/auth/login` and `/auth/register` are rate-limited. `/api/sync` triggers a full crawl of 80+ manga sources — no throttle means a single client can DoS the server repeatedly.

**Tasks:**
- Integrate **SlowAPI** (the FastAPI-native rate limiter)
- Set a global default limit (e.g. 60 req/min per IP)
- Apply stricter per-route limits: `/sync` (1/min), `/download` (5/min), `/search` (30/min)
- Return `429 Too Many Requests` with a `Retry-After` header
- Test it: write a small Python script that hammers an endpoint and verify the 429 fires

**Key tools:** SlowAPI, OWASP API Security Top 10 — API4:2023 Unrestricted Resource Consumption

**Resume Bullet:**
> Eliminated API abuse risk on a live application by implementing tiered rate limiting with SlowAPI, enforcing RFC-compliant 429 responses with Retry-After headers across all routes

---

## AppSec Track
*For Application Security Engineer roles. Do Foundation first.*

---

### Challenge 6 — SAST with Semgrep

**The problem:** No static analysis runs in the development cycle. Bugs and security flaws reach production undetected.

**Tasks:**
- Install Semgrep and run the `p/python`, `p/fastapi`, `p/jwt`, and `p/owasp-top-ten` rulesets against the backend
- Run `p/react` and `p/typescript` against the frontend
- Triage every finding: mark each as True Positive, False Positive, or Accepted Risk with a comment
- Fix all True Positive HIGH/CRITICAL findings
- Save a summary of findings + mitigations in `SECURITY.md`

**Key tools:** Semgrep (industry standard; appears in ~60% of AppSec job postings), CodeQL (GitHub-native alternative)

**Resume Bullet:**
> Performed SAST analysis of a full-stack Python/TypeScript application using Semgrep with OWASP Top 10 and framework-specific rulesets, triaging and remediating all high-severity findings

---

### Challenge 7 — SCA with Snyk

**The problem:** Dependencies are never scanned for known CVEs. A single vulnerable package can compromise the entire application.

**Tasks:**
- Run **Snyk** against both the backend (`snyk test`) and frontend (`snyk test`) — free tier is sufficient
- Review each CVE: understand the CVSS score, attack vector, and whether this app is actually exploitable
- Upgrade or replace any package with a HIGH/CRITICAL CVE that has a fix available
- Run `snyk monitor` to set up continuous monitoring

**Key tools:** Snyk (most mentioned SCA tool in job postings), OWASP Dependency-Check (alternative)

**Resume Bullet:**
> Conducted software composition analysis using Snyk on a production Python/Node.js application, assessed exploitability of identified CVEs, and remediated all high-severity vulnerable dependencies under continuous monitoring

---

### Challenge 8 — SBOM Generation & Supply Chain Security

**The problem:** No Software Bill of Materials (SBOM) exists. You can't secure what you can't inventory. SBOM is now required for US federal contractors (Executive Order 14028) and is increasingly demanded in enterprise environments.

**Tasks:**
- Generate a CycloneDX SBOM for the backend using **Syft** (`syft . -o cyclonedx-json > sbom-backend.json`)
- Generate an SBOM for the frontend Docker image
- Run **Grype** against both SBOMs to identify vulnerabilities (`grype sbom:sbom-backend.json`)
- Compare Grype's findings with Snyk's findings from Challenge 7
- Add SBOM generation as a GitHub Actions artifact

**Key tools:** Syft (Anchore), Grype, CycloneDX format, SPDX format

**Resume Bullet:**
> Implemented software supply chain security by generating CycloneDX SBOMs for a containerized Python/Node.js application using Syft, performing vulnerability analysis with Grype, and publishing SBOMs as CI pipeline artifacts

---

### Challenge 9 — DAST with OWASP ZAP

**The problem:** No dynamic application security testing runs against the live app. SAST finds code issues; DAST finds runtime vulnerabilities.

**Tasks:**
- Spin up a staging environment (duplicate your Docker Compose stack with a staging `.env`)
- Run **OWASP ZAP** baseline scan against it (`docker run -t owasp/zap2docker-stable zap-baseline.py -t https://staging-url`)
- Run the full active scan on endpoints you own
- Document every finding in `SECURITY.md`: severity, description, proof of concept, remediation
- Fix all Medium+ severity findings

**Key tools:** OWASP ZAP, Burp Suite Community (manual verification), OWASP Top 10

**Resume Bullet:**
> Performed DAST assessment of a self-hosted web application using OWASP ZAP, identified and documented runtime vulnerabilities including severity ratings and proof-of-concept reproductions, and remediated all medium-to-critical findings

---

### Challenge 10 — Web Application Penetration Test

**The problem:** Automated scanners miss logic flaws, broken authorization, and chained vulnerabilities. Manual testing catches what tools don't.

**Tasks:**
- Using **Burp Suite** (Community Edition), manually test your own application:
  - OWASP Top 10 A01: Can a regular user access admin endpoints?
  - OWASP Top 10 A02: Try forging or replaying a JWT
  - OWASP Top 10 A03: Test every input for injection (try `' OR 1=1--` in search, genre filter)
  - OWASP Top 10 A07: Test authentication edge cases (account enumeration on login, token leakage)
  - IDOR: Can you read/delete another user's bookmarks by changing the ID?
- Write a penetration test report: Executive Summary, Findings (severity + CVSS score + PoC + remediation), and Conclusion
- Save it as `PENTEST_REPORT.md`

**Key tools:** Burp Suite, OWASP Testing Guide (WSTG), OWASP Top 10

**Resume Bullet:**
> Conducted a manual web application penetration test against a production application using Burp Suite and the OWASP Testing Guide, authored a formal penetration test report with CVSS-scored findings and remediation steps

---

### Challenge 11 — Audit Logging & Forensic Trail

**The problem:** Admin actions and auth events leave no record. In a real incident, you'd have no forensic trail.

**Tasks:**
- Add an `audit_log` PostgreSQL table: `id`, `timestamp`, `user_id`, `action`, `ip_address`, `user_agent`, `result`, `metadata` (JSONB)
- Log: all auth events (login success/fail, logout, token refresh, registration), all admin actions (sync, editors-choice mutations), and all failed authorization attempts
- Expose `GET /api/admin/audit` (admin-only, paginated, filterable by action/user/date)
- Write a query that detects brute-force: more than 5 failed logins from the same IP in 10 minutes

**Key tools:** PostgreSQL JSONB, OWASP ASVS (Application Security Verification Standard)

**Resume Bullet:**
> Designed and implemented a comprehensive security audit logging system capturing authentication events, privileged actions, and authorization failures with forensic metadata, including anomaly detection queries for brute-force identification

---

## DevOps Track
*For DevOps / DevSecOps Engineer roles. Do Foundation first.*

---

### Challenge 12 — Secure Docker Builds

**The problem:** The backend has no Dockerfile. The frontend Dockerfile runs as root. Images have no size or vulnerability optimization.

**Tasks:**
- Write a multi-stage backend Dockerfile:
  - Stage 1 (`builder`): `python:3.11-slim`, install deps into a venv
  - Stage 2 (`runtime`): copy only the venv + app, create a non-root user (`useradd -r appuser`), run as that user
- Update the frontend Dockerfile to also run as non-root
- Run **Trivy** against both images (`trivy image <image>`) — fix all CRITICAL CVEs
- Add `.dockerignore` for both services

**Key tools:** Docker multi-stage builds, Trivy, Docker security best practices

**Resume Bullet:**
> Secured Docker builds for a Python/Node.js application using multi-stage builds, non-root runtime users, and Trivy container scanning, eliminating all critical CVEs from production images

---

### Challenge 13 — Production Docker Compose

**The problem:** The current compose file is dev-only: hardcoded credentials, no health checks, no restart policy, services exposed to the host.

**Tasks:**
- Create `infrastructure/docker-compose.prod.yml`:
  - Inject all secrets via `.env` file (no hardcoded values)
  - Health checks for each service with `test`, `interval`, `timeout`, `retries`
  - `restart: unless-stopped` on all services
  - Internal Docker network — only Nginx exposes public ports (80, 443)
  - Suwayomi and PostgreSQL bind to internal network only

**Resume Bullet:**
> Designed a production Docker Compose stack with secret injection, dependency health checks, restart policies, and network isolation — eliminating all direct public exposure of internal services

---

### Challenge 14 — Nginx Reverse Proxy + TLS

**The problem:** Port 4567 (Suwayomi) is accessible from the internet. TLS is not managed through the container stack.

**Tasks:**
- Add an Nginx container that:
  - Terminates TLS via Let's Encrypt using **Certbot** or **Caddy** (Caddy is simpler for auto-TLS)
  - Proxies `/api/*` → FastAPI, everything else → React frontend
  - Enforces HTTP → HTTPS 301 redirect
  - Includes Nginx hardening: disable server tokens, set `client_max_body_size`, enable gzip
  - Blocks all direct access to Suwayomi and PostgreSQL

**Key tools:** Nginx, Certbot / Caddy, Let's Encrypt, HTTPS

**Resume Bullet:**
> Deployed a hardened Nginx reverse proxy with automated Let's Encrypt TLS via Certbot, enforcing HTTPS for all traffic, segmenting internal services from public access, and applying server hardening configuration

---

### Challenge 15 — Kubernetes Deployment

**The problem:** The app only runs via Docker Compose — single host, no orchestration, no self-healing.

**Tasks:**
- Write Kubernetes manifests for each service (`Deployment`, `Service`, `ConfigMap`, `Secret`):
  - FastAPI backend (2 replicas)
  - React frontend (2 replicas)
  - PostgreSQL (`StatefulSet` with a `PersistentVolumeClaim`)
- Add liveness and readiness probes
- Use `kubectl apply` to deploy to a local cluster (Minikube or k3s)
- Set resource limits (`requests` and `limits` for CPU/memory) on every container

**Key tools:** Kubernetes, kubectl, Minikube or k3s (local), StatefulSet, PersistentVolumeClaim

**Resume Bullet:**
> Wrote Kubernetes manifests deploying a multi-service web application with StatefulSets, persistent storage, liveness/readiness probes, and resource limits, deploying to a local cluster via kubectl

---

### Challenge 16 — Terraform Infrastructure as Code

**The problem:** The server (mangaryu.org) was provisioned manually. There's no reproducible, version-controlled infrastructure definition.

**Tasks:**
- Write **Terraform** configuration to provision a VPS (DigitalOcean, Hetzner, or Linode — all have free tiers or cheap droplets):
  - Compute instance with the right size
  - Firewall rules: only ports 22, 80, 443 open
  - DNS A record pointing to the instance
- Use `terraform plan` and `terraform apply` to provision it
- Store Terraform state in a remote backend (Terraform Cloud free tier or an S3-compatible bucket)

**Key tools:** Terraform (HashiCorp), `terraform plan/apply/destroy`, remote state

**Resume Bullet:**
> Authored Terraform infrastructure-as-code to provision and configure a production VPS with firewall rules and DNS, using remote state backend — replacing manual server setup with reproducible, version-controlled infrastructure

---

### Challenge 17 — Prometheus + Grafana Monitoring

**The problem:** There's no metrics collection. You have no visibility into request rates, error rates, latency, or resource usage.

**Tasks:**
- Add **prometheus-fastapi-instrumentator** to the backend — it auto-exposes `/metrics` in Prometheus format
- Add Prometheus and Grafana containers to the Docker Compose stack
- In Grafana, build a dashboard with:
  - Request rate (req/sec) by endpoint
  - Error rate (4xx, 5xx) over time
  - p95 request latency
  - Active database connections
- Set up an alert in Grafana: notify if error rate exceeds 5% over 5 minutes

**Key tools:** Prometheus, Grafana, prometheus-fastapi-instrumentator, PromQL

**Resume Bullet:**
> Instrumented a FastAPI application with Prometheus metrics and built a Grafana observability dashboard tracking request rates, error rates, and latency percentiles, with automated alerting on error rate thresholds

---

## CI/CD Pipeline
*Automates everything from previous sections. Applies to both career paths.*

---

### Challenge 18 — GitHub Actions: Full Security Pipeline

**The problem:** No CI/CD exists. Security checks, tests, and builds all run manually (or not at all).

**Tasks — build a pipeline in `.github/workflows/` with these jobs:**

**Job 1: Code Quality** (runs on every PR)
  - `black --check` + `isort --check` (Python)
  - `mypy` (Python type checking)
  - `tsc --noEmit` + `eslint` (TypeScript)

**Job 2: Security Scan** (runs on every PR)
  - `semgrep --config=p/owasp-top-ten --config=p/python` (SAST)
  - `snyk test` for Python and Node.js (SCA)
  - `gitleaks detect` (secrets scan on PR diff)
  - Upload findings to GitHub Security tab via SARIF

**Job 3: Container Build + Scan** (runs on merge to main)
  - Build Docker images for backend + frontend
  - Run `trivy image` on both, fail on CRITICAL CVEs
  - Generate SBOM with Syft, attach as build artifact

**Job 4: Deploy** (runs after Job 3 passes)
  - SSH to production server, pull new images, `docker compose up -d`

**Key tools:** GitHub Actions, Semgrep, Snyk, Gitleaks, Trivy, Syft, SARIF

**Resume Bullet:**
> Built a GitHub Actions CI/CD pipeline with four sequential stages: code quality gates (mypy, ESLint), security scanning (Semgrep SAST, Snyk SCA, Gitleaks), container vulnerability scanning (Trivy) with SBOM generation, and automated production deployment

---

### Challenge 19 — Policy as Code

**The problem:** Docker and Kubernetes configs can drift from security standards. Manual review doesn't scale. Policy as Code enforces standards automatically.

**Tasks:**
- Use **Conftest** with OPA/Rego policies to lint configs at CI time:
  - Write a Rego policy that fails if a Dockerfile runs as root
  - Write a policy that fails if a Kubernetes manifest has no resource limits
  - Write a policy that fails if a container image uses the `latest` tag
- Run Conftest in the GitHub Actions pipeline on every PR

**Key tools:** Conftest, Open Policy Agent (OPA), Rego, Hadolint (alternative for Dockerfile linting)

**Resume Bullet:**
> Implemented policy-as-code using Open Policy Agent and Conftest, authoring Rego policies enforcing container security standards (non-root execution, image pinning, resource limits) enforced automatically in CI

---

### Challenge 20 — Dependabot + Automated Patching

**The problem:** Dependencies are never updated. CVEs accumulate silently until someone checks manually.

**Tasks:**
- Add `.github/dependabot.yml` covering:
  - Python packages (pip) — weekly, max 5 open PRs
  - Node.js packages (npm) — weekly, max 5 open PRs
  - Docker base images — monthly
  - GitHub Actions versions — monthly
- Configure auto-merge for patch-level updates that pass all CI checks (use a GitHub Actions workflow with `gh pr merge`)

**Key tools:** Dependabot, Renovate (alternative), GitHub Actions auto-merge

**Resume Bullet:**
> Automated software supply chain hygiene using Dependabot across Python, Node.js, Docker, and GitHub Actions ecosystems, with CI-gated auto-merge for patch releases — reducing mean time to patch known CVEs

---

## Advanced DevSecOps
*Senior-level challenges. These differentiate you from junior candidates.*

---

### Challenge 21 — Structured Logging + Log Aggregation

**The problem:** The backend logs with `print()`. Logs are unstructured, unqueryable, and not aggregated anywhere.

**Tasks:**
- Replace all `print()` with **python-json-logger** — structured JSON with `timestamp`, `level`, `logger`, `message`
- Add a FastAPI middleware injecting per-request context into every log line: `request_id`, `path`, `method`, `status_code`, `duration_ms`, `user_id`
- Stand up a **Loki** + **Promtail** + **Grafana** log aggregation stack (add to Docker Compose)
- In Grafana, build a log explorer query that shows all failed auth attempts in the last hour

**Key tools:** python-json-logger, Grafana Loki, Promtail, structured logging

**Resume Bullet:**
> Migrated a production backend from unstructured print logging to structured JSON logging with per-request tracing, integrated with a Grafana Loki log aggregation stack enabling real-time security event queries

---

### Challenge 22 — Secrets Management with HashiCorp Vault

**The problem:** Secrets live in `.env` files on the server. Anyone with server access can read all credentials in plaintext.

**Tasks:**
- Deploy **HashiCorp Vault** in dev mode locally, then in production mode (can run as a Docker container)
- Store the app's secrets in Vault: `JWT_SECRET`, `DATABASE_URL`, DB passwords
- Update the FastAPI backend to fetch secrets from Vault at startup using the Vault HTTP API or `hvac` Python client
- Enable Vault audit logging
- Write a Vault policy that limits the app to only reading its own secrets (principle of least privilege)

**Key tools:** HashiCorp Vault, hvac (Python client), Vault policies, AppRole auth method

**Resume Bullet:**
> Deployed HashiCorp Vault for production secrets management, migrating application credentials from plaintext environment files to Vault with least-privilege access policies and audit logging enabled

---

### Challenge 23 — Database Migrations with Alembic

**The problem:** Schema is created with raw `CREATE TABLE IF NOT EXISTS` in `database.py`. There's no migration history, no rollback capability, and no safe path for schema changes.

**Tasks:**
- Introduce **Alembic** to the backend
- Generate the initial migration from the existing schema (`alembic revision --autogenerate`)
- Add a new column (`last_seen TIMESTAMP` on the `users` table) via a proper `alembic revision`
- Implement a rollback (`alembic downgrade -1`) and verify it works
- Add `alembic upgrade head` as a step before app startup in the Docker entrypoint

**Key tools:** Alembic, PostgreSQL

**Resume Bullet:**
> Introduced Alembic database migration management to a production PostgreSQL application, replacing raw DDL with version-controlled migrations supporting both upgrade and rollback, integrated into the container startup sequence

---

### Challenge 24 — Incident Response Runbook

**The problem:** If the site goes down or gets compromised, there's no documented response process. You'd be improvising under pressure.

**Tasks:**
- Extend `/api/health` to check all dependencies: PostgreSQL, Suwayomi, disk space, memory — return `{"status": "ok"|"degraded"|"down", "checks": {...}}`
- Write an automated alerting script: poll the health endpoint every 5 minutes, send a Telegram or Discord notification on failure (store the bot token in Vault from Challenge 22)
- Write `RUNBOOK.md` covering three scenarios:
  - **Database unreachable**: steps to diagnose + restore
  - **High error rate**: how to read logs, identify the cause, rollback a deployment
  - **Suspected compromise**: steps to revoke tokens, rotate secrets, preserve forensic evidence

**Key tools:** Incident response, runbooks, SRE practices, Telegram/Discord webhooks

**Resume Bullet:**
> Authored incident response runbooks for a production web application covering database failure, error rate spikes, and security compromise scenarios, backed by automated health monitoring with Telegram alerting

---

### Challenge 25 — JWT Key Rotation (Zero Downtime)

**The problem:** The `JWT_SECRET` is set once and never rotated. A leaked secret means every user's session is permanently valid — with no way to invalidate tokens without logging everyone out.

**Tasks:**
- Implement a key versioning scheme: tokens include a `kid` (key ID) claim in the header
- Store two active keys in Vault (from Challenge 22): `current` and `previous`
- During token validation, try the current key first, fall back to the previous key
- Write a key rotation script: generate a new key, promote current → previous, new → current
- No active user sessions are interrupted during rotation; only tokens signed with the retired key expire naturally

**Key tools:** JWT `kid` header, JWKS (JSON Web Key Sets), HashiCorp Vault

**Resume Bullet:**
> Designed and implemented a zero-downtime JWT signing key rotation system using versioned key IDs and HashiCorp Vault, enabling secret rotation without session disruption and eliminating permanent token validity on key compromise

---

## Progress Tracker

| # | Challenge | Domain | Track | Status |
|---|-----------|--------|-------|--------|
| 1 | Secrets Management + Gitleaks | Security | Both | [ ] |
| 2 | Threat Modeling (STRIDE) | Security | Both | [ ] |
| 3 | Security Headers (Mozilla Observatory A+) | Security | Both | [ ] |
| 4 | CSRF Protection | Security | Both | [ ] |
| 5 | API Rate Limiting | Security | Both | [ ] |
| 6 | SAST with Semgrep | AppSec | AppSec | [ ] |
| 7 | SCA with Snyk | AppSec | AppSec | [ ] |
| 8 | SBOM with Syft + Grype | AppSec | AppSec | [ ] |
| 9 | DAST with OWASP ZAP | AppSec | AppSec | [ ] |
| 10 | Web App Penetration Test (Burp Suite) | AppSec | AppSec | [ ] |
| 11 | Audit Logging | AppSec | AppSec | [ ] |
| 12 | Secure Docker Builds (Trivy) | Infrastructure | DevOps | [ ] |
| 13 | Production Docker Compose | Infrastructure | DevOps | [ ] |
| 14 | Nginx Reverse Proxy + TLS | Infrastructure | DevOps | [ ] |
| 15 | Kubernetes Deployment | Infrastructure | DevOps | [ ] |
| 16 | Terraform Infrastructure as Code | Infrastructure | DevOps | [ ] |
| 17 | Prometheus + Grafana Monitoring | Observability | DevOps | [ ] |
| 18 | GitHub Actions: Full Security Pipeline | CI/CD | Both | [ ] |
| 19 | Policy as Code (OPA/Conftest) | CI/CD | Both | [ ] |
| 20 | Dependabot + Auto-Patching | CI/CD | Both | [ ] |
| 21 | Structured Logging + Loki | Observability | Advanced | [ ] |
| 22 | HashiCorp Vault | Secrets | Advanced | [ ] |
| 23 | Database Migrations (Alembic) | Backend | Advanced | [ ] |
| 24 | Incident Response Runbook | Operations | Advanced | [ ] |
| 25 | JWT Key Rotation (Zero Downtime) | Security | Advanced | [ ] |

---

## Resume & Portfolio Tips

**For every completed challenge:**
1. Commit the work with a descriptive message — your git history is a portfolio
2. If it's visible live (security headers, health endpoint, monitoring dashboard) — screenshot it
3. The `THREAT_MODEL.md` and `PENTEST_REPORT.md` are writing samples — AppSec jobs often ask for them

**Most valuable on an AppSec resume (ranked):**
1. Semgrep + Snyk in CI (Challenges 6, 7, 18)
2. Threat Model (Challenge 2)
3. OWASP ZAP DAST (Challenge 9)
4. Pentest report with Burp Suite (Challenge 10)
5. SBOM generation (Challenge 8)

**Most valuable on a DevOps/DevSecOps resume (ranked):**
1. Terraform IaC (Challenge 16)
2. Kubernetes deployment (Challenge 15)
3. GitHub Actions full pipeline (Challenge 18)
4. HashiCorp Vault (Challenge 22)
5. Prometheus + Grafana (Challenge 17)

**Certifications that align with this track:**
- AppSec path: **CEH**, **GWAPT**, **eWPT** (eLearnSecurity)
- DevOps path: **Terraform Associate**, **CKA** (Certified Kubernetes Administrator)
- Both: **CDP** (Certified DevSecOps Professional — Practical DevSecOps)
