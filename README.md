# torrent-tv infra

Docker Compose infrastructure for deploying torrent-tv on a VPS.

## Stack

- **server** — Node.js app (`@torrent-tv/server`)
- **nginx** — reverse proxy (port 80), HTTPS is handled by Cloudflare
- **watchtower** — auto-pulls updated images in production

## Directory layout

```
infra/
├── docker-compose.yml          # base: server + nginx
├── docker-compose.prod.yml     # prod extras: watchtower
├── docker-compose.local.yml    # local dev: build server from source
└── nginx/
    ├── webauth.courses.conf    # reverse proxy for webauth.courses
    └── compression.common      # shared gzip settings
```

## Server layout (droplet)

Clone both repos side-by-side so the build context resolves correctly:

```
/srv/torrent-tv/
├── infra/    ← this repo
└── server/   ← git@github.com-personal:torrent-tv/server.git
```

## Deploy

```bash
# first time
git clone git@github.com-personal:torrent-tv/infra.git
git clone git@github.com-personal:torrent-tv/server.git
cd infra
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

```bash
# update
cd /srv/torrent-tv/server && git pull
cd /srv/torrent-tv/infra  && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Local dev

```bash
cd infra
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

## Adding a new service

1. Add a new service to `docker-compose.yml`
2. Add `nginx/<your-domain>.conf` with a `proxy_pass` to the new service
3. Add a DNS A record in Cloudflare pointing to the droplet IP with the orange cloud enabled
