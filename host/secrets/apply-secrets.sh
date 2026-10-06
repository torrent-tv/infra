#!/bin/sh
# Receives the production secrets from the deploy pipeline and makes them
# environment variables of the stack. Installed on the droplet as
# /usr/local/sbin/ttv-apply-secrets and run ONLY as the forced command of the
# pipeline's SSH key (README, "Secrets"; torrent-tv/meta#143): the key can
# do nothing else on the host.
#
# stdin: lines NAME=value, one per secret. Only the names below are accepted.
# It writes /websites/infra/secrets.env (mode 600) and, when the content changed,
# recreates doco-cd, which passes that environment to the compose interpolation
# (PASS_ENV, host/doco-cd/docker-compose.yml). The next deployment starts the
# services with the values.
set -eu

ALLOWED="TMDB_READ_TOKEN OPENSUBTITLES_API_KEY JIMAKU_API_KEY STASHDB_API_KEY THEPORNDB_API_KEY"
TARGET=/websites/infra/secrets.env
TMP="$TARGET.new"

umask 077
: > "$TMP"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name=${line%%=*}
  value=${line#*=}
  case " $ALLOWED " in *" $name "*) ;; *) echo "refused: $name is not an accepted secret" >&2; rm -f "$TMP"; exit 1 ;; esac
  # A `$` would be read as an interpolation by compose; a value never needs one.
  case "$value" in ''|*\$*|*[!A-Za-z0-9._~+/=:@-]*) echo "refused: the value of $name has a character that is not allowed" >&2; rm -f "$TMP"; exit 1 ;; esac
  printf '%s=%s\n' "$name" "$value" >> "$TMP"
done

if [ -f "$TARGET" ] && cmp -s "$TMP" "$TARGET"; then
  rm -f "$TMP"
  echo "secrets unchanged"
  exit 0
fi
mv "$TMP" "$TARGET"
echo "secrets written ($(wc -l < "$TARGET") names); recreating doco-cd"

git -C /websites/infra pull --ff-only -q
docker compose -p doco-cd -f /websites/infra/host/doco-cd/docker-compose.yml up -d --force-recreate
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8090/v1/health > /dev/null 2>&1; then echo "doco-cd is healthy"; exit 0; fi
  sleep 2
done
echo "doco-cd did not become healthy" >&2
exit 1
