#!/usr/bin/env bash
# The checks of the compose files and nginx that need no secret and no network
# beyond pulling the pinned images. main.yml runs them one step each, so a run shows
# which one failed; dependencies.yml runs `all` on every commit it prepares.
#
#   bash scripts/check.sh pins | images | compose | nginx | nginx-upgrade
#   bash scripts/check.sh revision <base-commit> [<head-commit>]
#   bash scripts/check.sh all
set -euo pipefail
cd "$(dirname "$0")/.."

pins() {
  # Security rule 6: no range and no `latest`, in dependencies, devDependencies,
  # optionalDependencies and overrides; an `npm:` alias names an exact version.
  node -e '
    const pkg = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"));
    const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
    const bad = [];
    const walk = (where, value) => {
      if (typeof value === "string") {
        const spec = value.startsWith("npm:") ? value.slice(value.lastIndexOf("@") + 1) : value;
        if (!exact.test(spec)) bad.push(where + " = " + value);
      } else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) walk(where + "." + key, inner);
      }
    };
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "overrides"]) walk(field, pkg[field]);
    if (bad.length) {
      console.error("::error::not an exact version: " + bad.join("; "));
      process.exit(1);
    }
    console.log("every dependency is pinned exactly");'
}

images() {
  # So the file says exactly what runs.
  if grep -hE '^\s+image:' docker-compose.yml host/doco-cd/docker-compose.yml | grep -v '@sha256:'; then
    echo "::error::an image above is not pinned by digest"
    return 1
  fi
}

compose() {
  docker compose -f docker-compose.yml config --quiet
  docker compose -f host/doco-cd/docker-compose.yml config --quiet
}

nginx() {
  # Checked by the nginx image that will run it.
  local image
  image=$(sed -nE '/^  nginx:/,/^  [^ ]/s/^    image: (.*)$/\1/p' docker-compose.yml)
  docker run --rm -v "$PWD/nginx:/etc/nginx/conf.d:ro" "$image" nginx -t
}

nginx_upgrade() {
  local image
  image=$(sed -nE '/^  nginx-upgrade:/,/^  [^ ]/s/^    image: (.*)$/\1/p' docker-compose.yml)
  NGINX_UPGRADE_IMAGE="$image" bash scripts/check-nginx-live-upgrade.sh
}

revision() {
  # CI reads the revision back after deploying.
  local base=${1:-} head=${2:-HEAD}
  if [ -n "$base" ] && ! [[ "$base" =~ ^0+$ ]] && git cat-file -e "$base^{commit}" 2>/dev/null; then
    node scripts/check-nginx-revision.mjs "$base..$(git rev-parse "$head")"
  fi
}

case "${1:-}" in
  pins) pins ;;
  images) images ;;
  compose) compose ;;
  nginx) nginx ;;
  nginx-upgrade) nginx_upgrade ;;
  revision) revision "${2:-}" "${3:-HEAD}" ;;
  all) pins && images && compose && nginx && nginx_upgrade ;;
  *) echo "usage: bash scripts/check.sh pins|images|compose|nginx|nginx-upgrade|revision <base> [<head>]|all" >&2; exit 2 ;;
esac
