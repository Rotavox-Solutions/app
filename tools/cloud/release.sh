#!/usr/bin/env bash
# release.sh — install one release on the cloud VM. cloud.sh deploy streams the
# committed tree here and runs this as root from inside it:
#   release.sh <sha>     (cwd: the unpacked release, /opt/rotavox/releases/<sha>)
#
# Same order as `rotavox.ps1 update`: deps, migrate, build, then switch. Every
# step before the switch runs beside the live release, so a failure leaves the
# old code serving. If the new release doesn't answer after the restart, the
# symlink goes back and the old release is restarted.
set -euo pipefail

SHA=$1
DIR=/opt/rotavox/releases/$SHA
KEEP=3
[ "$(pwd)" = "$DIR" ] || { echo "Run from $DIR" >&2; exit 1; }

# Runs as the app's user with the app's env, as the service will.
as_app() { sudo -u rotavox env HOME=/opt/rotavox bash -c 'set -a; . /etc/rotavox/web.env; set +a; "$@"' _ "$@"; }
step() { printf '\n== %s\n' "$*"; }

chown -R rotavox:rotavox "$DIR"
step "Install dependencies"
# web.env sets NODE_ENV=production, which would skip the dev tools migrate and build need.
as_app npm ci --include=dev --no-audit --no-fund
step "Migrate the database"
as_app npm run migrate -w @rotavox/schema
step "Build the web app"
# The build records its commit: the staff console shows it, and Runners update to it.
as_app env ROTAVOX_REVISION="$SHA" npm run build -w @rotavox/web

PREVIOUS=$(readlink -f /opt/rotavox/current 2>/dev/null || true)
step "Switch to $SHA"
ln -sfn "$DIR" /opt/rotavox/current
systemctl restart rotavox-web

healthy() {
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login)" = 200 ] && return 0
    sleep 2
  done
  return 1
}
if ! healthy; then
  journalctl -u rotavox-web -n 40 --no-pager || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$DIR" ]; then
    echo "New release didn't answer on /login; going back to $(basename "$PREVIOUS")." >&2
    ln -sfn "$PREVIOUS" /opt/rotavox/current
    systemctl restart rotavox-web
  fi
  exit 1
fi

# Keep the newest few releases for a quick manual rollback.
ls -1dt /opt/rotavox/releases/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(readlink -f "$old")" = "$DIR" ] || rm -rf -- "$old"
done
echo "Deployed $SHA"
