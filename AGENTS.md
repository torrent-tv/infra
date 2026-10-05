# infra — hosting & infrastructure notes

nginx + docker-compose for the `webauth.courses` server. See the parent `../CLAUDE.md` for the overall architecture.

## Current Droplet (as of June 2026)

| Field | Value |
|---|---|
| Plan | s-1vcpu-1gb (Basic, Shared CPU) |
| Resources | 1 vCPU · 1 GB RAM · 25 GB SSD NVMe |
| Region | AMS3 (Amsterdam) |
| OS | Ubuntu 24.04 LTS x64 |
| Public IP | 206.189.97.152 |
| Standard price | ~$6/month |
| Effective price | ~$1.20/month (promotional DO credits active) |

## Bandwidth

| Metric | Value |
|---|---|
| Included outbound | 1000 GB (1 TB) / month |
| Overage | $0.01 / GB |
| Current usage | ~0.29 GB/month (signalling only — near zero) |

DigitalOcean counts **outbound** traffic from the Droplet.
Inbound is free. The 1 TB pool is not pooled across regions.

## Stack

Traffic path:

```
Browser / Proxy client
  → Cloudflare (HTTPS termination, free plan, orange cloud)
  → Droplet :80 (nginx)
  → Node.js server :8080 (WebRTC signalling + proxy registry + static files)
```

The server today handles only:
- WebSocket signalling messages (bytes, not video)
- Static JS/HTML/CSS assets (served by nginx from Docker volume, not Node.js)
- Health/API calls

Video **never** touches this server — it flows P2P via WebRTC between the browser and the user's home proxy.

## Remote access limitation (key architectural constraint)

The P2P WebRTC design works when browser and proxy are on the same LAN.
When the browser is on **mobile internet (cellular)**, the connection fails because:
- Carrier-grade NAT (CGNAT) on the mobile operator's side
- Home NAT on the proxy's side
- STUN alone cannot punch through symmetric / double NAT

### Why adding a relay through this server doesn't scale

If we added a video relay fallback (TURN server or WebSocket tunnel forwarding):

| Scenario | Transfer / hour |
|---|---|
| 1080p stream | ~2.25 GB/hr |
| Included 1 TB pool | ~444 relay-hours/month |
| 10 users × 2 hrs/day × 30 days | 600 hrs → 1350 GB → **350 GB overage = $3.50/month extra** |
| 100 users × 2 hrs/day × 30 days | 6000 hrs → 13500 GB → **$125/month in overage alone** |

Additionally, **Cloudflare's free plan prohibits serving video/large media files**. If video were to flow through Cloudflare (browser → CF → Droplet → CF → browser), Cloudflare can throttle or terminate the account. The current setup works only because video bypasses this path entirely.

### Decided remote-access direction

Make every proxy publicly reachable **automatically** (the Plex model — full
plan in the root `../CLAUDE.md`): UPnP port mapping on the proxy, dial-back
reachability probe from this server, per-proxy DNS + TLS (next section). No
relay through this droplet — video always flows directly browser→proxy. Relay
and TURN options were evaluated and rejected (bandwidth cost above; Cloudflare
ToS prohibits proxying video).

## Per-proxy DNS + TLS (planned)

plex.direct-style scheme so browsers can speak HTTPS to home proxies:

- Per-proxy hostnames under a dedicated subdomain, e.g.
  `<proxyId>.p.<domain>` → public IP and `lan.<proxyId>.p.<domain>` → LAN IP,
  managed via the **Cloudflare API** (plain DDNS-style A/AAAA records).
- Records MUST be **DNS-only (grey cloud)**. Orange-cloud (proxied) records
  would route video through Cloudflare: prohibited by free-plan ToS,
  re-creates the relay we avoid, and CF only proxies a fixed port list anyway.
  Consequence: **no automatic Cloudflare edge certificate** for these names —
  that automatic HTTPS exists only for orange-cloud records (which is why
  `webauth.courses` gets it "for free"). Hence:
- Per-proxy **Let's Encrypt** certificates issued by the server via DNS-01
  (`acme-client` npm + CF API for the `_acme-challenge` TXT records),
  delivered to the proxy over the existing WebSocket tunnel; the proxy
  terminates TLS itself. Re-issue before the ~90-day expiry.

Limits to watch:

- Cloudflare free zones created after 2024-09: **200 DNS records/zone** →
  ~60–100 proxies at 2–3 records each. When the limit nears, switch to an own
  algorithmic DNS responder (sslip.io / plex.direct style — the IP is encoded
  in the hostname label, nothing is stored). Do not build it earlier.
- Let's Encrypt: **50 new certificates per registered domain per week**
  (renewals are exempt). Enough for the POC; request a rate-limit increase at
  scale. DNS-PERSIST-01 (announced Feb 2026) may simplify re-issuance.
- Some routers' DNS-rebind protection drops public-DNS answers that contain
  private IPs — affects only the optional `lan.*` records, degradation is
  soft (known plex.direct issue).

## Scaling implications (POC → production)

This Droplet is correctly sized for its **current role** (signalling only):
- CPU: the Node.js signalling server is not CPU-bound
- RAM: 1 GB is sufficient for nginx + Node.js (no ffmpeg, no torrent client here)
- Bandwidth: 0.29 GB last month — well within the 1 TB pool

If the server role expands to **relay** or **HLS delivery**, the Droplet plan and provider must be re-evaluated. The $6/month plan is not suitable for serving video at scale.

## Cloudflare setup

- Domain `webauth.courses` uses Cloudflare DNS with the **orange cloud (proxy) enabled**.
- Cloudflare terminates HTTPS; the Droplet itself only listens on HTTP :80.
- This means **no Let's Encrypt needed** on the Droplet.
- WebSocket connections (`/ws/`) work through Cloudflare — 100 s idle timeout applies; the proxy tunnel already sends keepalive pings every 30 s to stay under it.
- Cloudflare caches static assets (JS/CSS/HTML) — good for frontend delivery.
- Cloudflare **does not** and **must not** proxy video streaming traffic (ToS + practical limits).

## Commits and deploy

Every commit header follows Conventional Commits (`<type>(<scope>)!: <subject>`,
types `feat fix perf refactor docs test build ci chore style revert`); CI refuses
a pushed commit that does not. Enable the local check once per clone:
`git config core.hooksPath .githooks`. Rules: `torrent-tv/.github` CONTRIBUTING.md.

A push to `main` runs `.github/workflows/main.yml`: commit headers, line endings,
every image pinned by digest, `docker compose config`, `nginx -t` in the pinned
nginx image, and a raised `nginx/revision.common` for any change under `nginx/`.
The serial `deploy` job then moves `production` to the checked commit (never
backwards, never forced), asks doco-cd on the droplet to apply it through a signed
webhook, follows the run, and checks the live site and page from outside. CI has
no login to the host. doco-cd itself (`host/doco-cd/`) is updated by hand.
Details, bootstrap and rollback: README and torrent-tv/meta#93.

## Logs

Every container on the droplet logs to the host journal (`journald` driver, tag
`torrent-tv-<source>`), and rsyslog writes one file per source to
`/var/log/torrent-tv/`: `server.log`, `client.log` (browser lines forwarded to the
server), `nginx.log`, `doco-cd.log`. They survive deployments; `docker logs`
shows only the current container. `TTV_LOG_DRIVER` picks another driver at
start. The rsyslog rule and the rotation (`host/logs/`) are installed by hand.
How to read them, retention and installation: README, "Logs" (meta#96).

The droplet has been applied by doco-cd since 2026-10-03 (meta#93). Change it by
pushing to `main`; `prod.sh` is only for when doco-cd itself is down.
