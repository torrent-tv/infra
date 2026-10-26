#!/bin/sh
set -eu

pid_file=/var/run/nginx.pid
stopping=false

stop_nginx() {
  stopping=true
  for file in "$pid_file" "$pid_file.oldbin"; do
    if [ -r "$file" ]; then
      pid=$(cat "$file")
      kill -QUIT "$pid" 2>/dev/null || true
    fi
  done
}

trap stop_nginx QUIT TERM INT

# nginx runs as a child so this shell remains PID 1 when nginx replaces its
# master. It also reaps the old master after nginx's live upgrade completes.
nginx -g 'daemon on; worker_shutdown_timeout 30s;'

while [ "$stopping" = false ]; do
  if [ ! -r "$pid_file" ]; then
    # USR2 renames the old PID file before writing the replacement.
    if [ -r "$pid_file.oldbin" ]; then
      sleep 1 &
      wait "$!" || true
      continue
    fi
    echo "nginx master PID file is missing" >&2
    exit 1
  fi
  pid=$(cat "$pid_file")
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "nginx master $pid is not running" >&2
    exit 1
  fi
  sleep 1 &
  wait "$!" || true
done

deadline=$(( $(date +%s) + 55 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  running=false
  for file in "$pid_file" "$pid_file.oldbin"; do
    if [ -r "$file" ] && kill -0 "$(cat "$file")" 2>/dev/null; then
      running=true
    fi
  done
  [ "$running" = false ] && exit 0
  sleep 1
done

echo "nginx masters did not stop within 55 seconds" >&2
exit 1
