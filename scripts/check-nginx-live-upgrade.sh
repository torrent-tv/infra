#!/usr/bin/env bash
set -euo pipefail

# This pinned image predates the current executable and exercises a real binary change.
old_image='nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2'
new_image=${NGINX_UPGRADE_IMAGE:?set NGINX_UPGRADE_IMAGE to the pinned nginx-upgrade image}
container="nginx-upgrade-check-${GITHUB_RUN_ID:-$$}"
directory=$(mktemp -d)
upgrade_pid=

cleanup() {
  if [ -n "$upgrade_pid" ]; then
    kill "$upgrade_pid" 2>/dev/null || true
    wait "$upgrade_pid" 2>/dev/null || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$directory"
}
trap cleanup EXIT

cat > "$directory/default.conf" <<'NGINX'
server {
    listen 80;
    location = /_infra/revision { return 200 "1\n"; }
    location = /version { return 200 "$nginx_version\n"; }
}
NGINX

old_version=$(docker run --rm --entrypoint /usr/sbin/nginx "$old_image" -v 2>&1)
new_version=$(docker run --rm --entrypoint /usr/sbin/nginx "$new_image" -v 2>&1)
old_number=$(printf '%s\n' "$old_version" | sed -nE 's/.*nginx\/([0-9.]+).*/\1/p')
new_number=$(printf '%s\n' "$new_version" | sed -nE 's/.*nginx\/([0-9.]+).*/\1/p')
old_hash=$(docker run --rm --entrypoint /bin/sh "$old_image" -c 'sha256sum /usr/sbin/nginx' | awk '{ print $1 }')
new_hash=$(docker run --rm --entrypoint /bin/sh "$new_image" -c 'sha256sum /usr/sbin/nginx' | awk '{ print $1 }')
if [ -z "$old_number" ] || [ -z "$new_number" ] || [ "$old_hash" = "$new_hash" ]; then
  echo "test images must contain different nginx executables (old=$old_version $old_hash; new=$new_version $new_hash)" >&2
  exit 1
fi

docker run -d --name "$container" --publish 127.0.0.1::80 \
  --volume "$PWD/scripts/nginx-supervisor.sh:/scripts/nginx-supervisor.sh:ro" \
  --volume "$directory/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  --entrypoint /bin/sh "$old_image" /scripts/nginx-supervisor.sh >/dev/null
port=$(docker port "$container" 80/tcp | awk -F: 'NR == 1 { print $NF }')
url="http://127.0.0.1:$port"
for attempt in $(seq 1 60); do
  if curl --fail --silent "$url/version" >/dev/null; then break; fi
  if [ "$attempt" -eq 60 ]; then
    echo "old nginx did not start" >&2
    docker logs "$container" >&2
    exit 1
  fi
  sleep 0.25
done
served_version=$(curl --fail --silent "$url/version")
if [ "$served_version" != "$old_number" ]; then
  echo "unexpected old nginx response: $served_version" >&2
  exit 1
fi

docker run --rm --pid="container:$container" --network="container:$container" \
  --volume "$PWD/scripts/nginx-upgrade.sh:/scripts/nginx-upgrade.sh:ro" \
  --volume "$directory/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  --entrypoint /bin/sh "$new_image" /scripts/nginx-upgrade.sh >"$directory/upgrade.log" 2>&1 &
upgrade_pid=$!
failures=0
while kill -0 "$upgrade_pid" 2>/dev/null; do
  if ! curl --fail --silent --max-time 1 "$url/version" >/dev/null; then
    failures=$((failures + 1))
  fi
  sleep 0.05
done
if ! wait "$upgrade_pid"; then
  cat "$directory/upgrade.log" >&2
  docker logs "$container" >&2 || true
  docker exec "$container" /bin/sh -c 'ls -l /var/run/nginx.pid* 2>&1; ps' >&2 || true
  exit 1
fi
upgrade_pid=

if [ "$failures" -ne 0 ]; then
  echo "the site failed to answer during nginx's live upgrade ($failures failed requests)" >&2
  exit 1
fi
served_version=$(curl --fail --silent "$url/version")
if [ "$served_version" != "$new_number" ]; then
  echo "new nginx did not take over the listener: $served_version" >&2
  cat "$directory/upgrade.log" >&2
  exit 1
fi
master_pid=$(docker exec "$container" cat /var/run/nginx.pid)
served_hash=$(docker exec "$container" sha256sum "/proc/$master_pid/exe" | awk '{ print $1 }')
if [ "$served_hash" != "$new_hash" ]; then
  echo "nginx kept serving the old executable: $served_hash" >&2
  exit 1
fi
if docker exec "$container" test -e /var/run/nginx.pid.oldbin; then
  echo "old nginx master did not leave the PID file behind" >&2
  exit 1
fi
cat "$directory/upgrade.log"
