#!/bin/sh
set -eu

target_root=/proc/1/root
pid_file="$target_root/var/run/nginx.pid"
old_pid_file="$pid_file.oldbin"
work="$target_root/run/nginx-upgrade"

if [ ! -r "$pid_file" ]; then
  echo "nginx PID file is missing; refusing the image update" >&2
  exit 1
fi
if [ -e "$old_pid_file" ]; then
  echo "an earlier nginx executable upgrade has not drained" >&2
  exit 1
fi

old_pid=$(cat "$pid_file")
if ! kill -0 "$old_pid" 2>/dev/null; then
  echo "nginx master $old_pid is not running" >&2
  exit 1
fi

source_version=$(nginx -v 2>&1)
current_version=$(chroot "$target_root" /usr/sbin/nginx -v 2>&1)
source_hash=$(sha256sum /usr/sbin/nginx | awk '{ print $1 }')
current_hash=$(sha256sum "$target_root/usr/sbin/nginx" | awk '{ print $1 }')
if [ "$source_hash" = "$current_hash" ]; then
  echo "nginx executable is already current: $current_version"
  exit 0
fi

# The live configuration does not load dynamic modules. Fail closed if that
# changes until matching modules are handled by this update.
if grep -R -E '^[[:space:]]*load_module[[:space:]]' /etc/nginx /usr/share/nginx 2>/dev/null; then
  echo "dynamic nginx modules need an explicit live-upgrade path" >&2
  exit 1
fi

rm -rf "$work"
mkdir -p "$work"
cp /usr/sbin/nginx "$work/nginx.new"
chmod 755 "$work/nginx.new"

# Install the new executable's shared libraries into the running container and
# retain their prior files for rollback. Existing workers keep their mapped
# versions; new workers load these files when the new master starts.
libraries=$(ldd /usr/sbin/nginx | awk '/=> \/[^ ]+/ { print $3 } /^\// { print $1 }' | sort -u)
: > "$work/libraries"
while IFS= read -r library; do
  [ -n "$library" ] || continue
  case "$library" in
    /lib/*|/usr/lib/*) ;;
    *) echo "unsupported nginx library path: $library" >&2; exit 1 ;;
  esac
  [ -f "$library" ] || { echo "nginx library is missing: $library" >&2; exit 1; }
  printf '%s\n' "${library#/}" >> "$work/libraries"
done <<EOF
$libraries
EOF

mkdir -p "$work/backup"
while IFS= read -r relative; do
  [ -n "$relative" ] || continue
  if [ -e "$target_root/$relative" ] || [ -L "$target_root/$relative" ]; then
    mkdir -p "$work/backup/$(dirname "$relative")"
    cp -a "$target_root/$relative" "$work/backup/$relative"
  fi
done < "$work/libraries"

cp "$target_root/usr/sbin/nginx" "$work/nginx.old"

rollback_needed=true
new_pid=
rollback_files() {
  if [ -f "$work/nginx.old" ]; then
    chroot "$target_root" /bin/mv /run/nginx-upgrade/nginx.old /usr/sbin/nginx
  fi
  if [ -f "$work/libraries" ]; then
    while IFS= read -r relative; do
      [ -n "$relative" ] || continue
      if [ -e "$work/backup/$relative" ] || [ -L "$work/backup/$relative" ]; then
        mkdir -p "$target_root$(dirname "/$relative")"
        cp -a "$work/backup/$relative" "$target_root/$relative.nginx-old"
        chroot "$target_root" /bin/mv "/$relative.nginx-old" "/$relative"
      else
        chroot "$target_root" /bin/rm -f "/$relative"
      fi
    done < "$work/libraries"
  fi
}

rollback_live_upgrade() {
  if [ -n "$new_pid" ]; then
    rollback_files
    if kill -0 "$old_pid" 2>/dev/null; then kill -HUP "$old_pid" 2>/dev/null || true; fi
    if kill -0 "$new_pid" 2>/dev/null; then
      kill -QUIT "$new_pid" 2>/dev/null || true
      deadline=$(( $(date +%s) + 35 ))
      while [ "$(date +%s)" -lt "$deadline" ] && kill -0 "$new_pid" 2>/dev/null; do sleep 1; done
    fi
    if kill -0 "$new_pid" 2>/dev/null; then
      echo "new nginx master $new_pid did not stop; leaving its executable files in place" >&2
      rollback_needed=false
      return
    fi
    if [ -r "$old_pid_file" ] && [ ! -e "$pid_file" ]; then mv "$old_pid_file" "$pid_file"; fi
  else
    if [ -r "$old_pid_file" ] && [ ! -e "$pid_file" ]; then mv "$old_pid_file" "$pid_file"; fi
    rollback_files
    if kill -0 "$old_pid" 2>/dev/null; then kill -HUP "$old_pid" 2>/dev/null || true; fi
  fi
  rollback_needed=false
}

rollback_on_exit() {
  if [ "$rollback_needed" = true ]; then rollback_live_upgrade; fi
}
trap rollback_on_exit EXIT

while IFS= read -r relative; do
  [ -n "$relative" ] || continue
  library="/$relative"
  mkdir -p "$target_root$(dirname "$library")"
  cp -L "$library" "$target_root$library.nginx-new"
  chmod 755 "$target_root$library.nginx-new"
  chroot "$target_root" /bin/mv "$library.nginx-new" "$library"
done < "$work/libraries"

if ! chroot "$target_root" /run/nginx-upgrade/nginx.new -t -g 'worker_shutdown_timeout 30s;'; then
  echo "new nginx executable failed configuration or library validation; restoring the previous executable" >&2
  exit 1
fi

chroot "$target_root" /bin/mv /run/nginx-upgrade/nginx.new /usr/sbin/nginx
kill -USR2 "$old_pid"

deadline=$(( $(date +%s) + 30 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -r "$pid_file" ]; then
    candidate=$(cat "$pid_file")
    if [ "$candidate" != "$old_pid" ] && kill -0 "$candidate" 2>/dev/null; then
      new_pid=$candidate
      break
    fi
  fi
  if ! kill -0 "$old_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ -z "$new_pid" ]; then
  echo "new nginx master did not start; restoring the previous executable" >&2
  exit 1
fi

# The new workers accept connections while the old workers are still serving.
# Probe the listener before asking the old workers to drain.
healthy=false
deadline=$(( $(date +%s) + 15 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if wget -qO- http://127.0.0.1/_infra/revision >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [ "$healthy" != true ]; then
  echo "new nginx workers failed the live health check; restoring the previous executable" >&2
  exit 1
fi

rollback_needed=false
kill -WINCH "$old_pid"
kill -QUIT "$old_pid"

deadline=$(( $(date +%s) + 45 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kill -0 "$old_pid" 2>/dev/null; then
    echo "nginx upgraded: $current_version -> $source_version"
    exit 0
  fi
  sleep 1
done

echo "new nginx is serving, but the old master did not drain within 45 seconds" >&2
exit 1
