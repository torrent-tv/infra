Read `../AGENTS.md` first. It holds the project-wide rules (a link to `meta/AGENTS.md` made by meta's setup script; a task worktree sees the same link). This file adds only what is specific to this repository.

# infra — the droplet that runs the server

nginx and Docker Compose for `webauth.courses`, applied on the droplet by
doco-cd from the `production` branch after CI has checked the commit. Stack,
directory layout, deployment, the two server slots, secrets, logs and recovery
are described in [`README.md`](README.md); read the section you touch before
changing it. Planned per-proxy DNS and TLS (with the Cloudflare and Let's
Encrypt limits that bound it) and the cost of relaying through a droplet:
[meta `research/remote-access-direction-2026-07-11.md`](https://github.com/torrent-tv/meta/blob/main/research/remote-access-direction-2026-07-11.md).

## The host

- DigitalOcean droplet `s-1vcpu-1gb` in AMS3: 1 vCPU, 1 GB RAM, 25 GB disk,
  Ubuntu 24.04, public IPv4 206.189.97.152.
- Reach it with `ssh do` (alias in `~/.ssh/config`); `root@<ip>` without the
  alias has no key.
- Traffic: browser or proxy → Cloudflare (HTTPS, orange cloud) → nginx :80 →
  server :8080 (`server-a` or `server-b`). Static files are served by nginx from
  the shared volume, not by Node.

## Rules

- **Video never flows through this droplet or through Cloudflare.** Cloudflare's
  free plan forbids serving video, and the droplet's outbound traffic is metered
  (1 TB a month included). The server carries signalling, the registry, the
  page and its API only.
- **Every image is pinned by tag and digest** in `docker-compose.yml`; CI refuses
  an unpinned one.
- **A change under `nginx/` raises the number in `nginx/revision.common`** in
  the same commit; CI refuses it otherwise, and the deployment checks that
  `/_infra/revision` serves the new number (an invalid configuration is kept
  out by nginx itself, so that check is what catches it).

## Deploy path

Merging to `main` runs `.github/workflows/main.yml`. Changesets, versions and
the release are shared by every repository and are written once, in the
organization's
[`CONTRIBUTING.md`](https://github.com/torrent-tv/workflows/blob/main/CONTRIBUTING.md#versions-and-releases)
("Versions and releases", "How a release reaches its users", "Dependencies");
the changeset front matter names `"torrent-tv-infra"`. After `version`, the
checks are: commit headers, branch name, workflows, exact dependency versions,
image digests, `docker compose config`, `nginx -t` in the pinned nginx image,
nginx's live executable upgrade, and the nginx revision (`scripts/check.sh`); a pull request also gets `copies`,
`changeset-format` and `changesets-selftest` of that script;
`publish` tags and releases each version.
The serial `deploy` job then moves `production` to the checked commit (never
backwards, never forced), asks doco-cd to apply it through a signed webhook,
follows the run and the server handover, and checks the site and the page from
outside. CI has no login to the host except the one restricted command in the
`deploy` job's step "Deliver the secrets" (`README.md`, "Secrets").
`host/doco-cd/` and `host/logs/` are installed on the host by hand; `prod.sh` is
only for when doco-cd itself is down.

## Logs

Every container logs to the host journal (`journald` driver, tag
`torrent-tv-<source>`); rsyslog writes `/var/log/torrent-tv/server.log`,
`client.log` (browser lines forwarded to the server), `nginx.log` and
`doco-cd.log`, which survive deployments. Reading them, retention and the
limits of `docker logs`: [`README.md`, "Logs"](README.md#logs). The browser's
lines during a viewing are on the proxy
([`docs/logs.md`](https://github.com/torrent-tv/proxy/blob/main/docs/logs.md)).
