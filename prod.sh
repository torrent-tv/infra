#!/usr/bin/env bash
# Apply the stack by hand, when doco-cd is not available. Every image is pinned by
# digest, so this starts exactly what docker-compose.yml names.
set -euo pipefail
cd "$(dirname "$0")"
docker compose -p infra -f docker-compose.yml up -d --remove-orphans
