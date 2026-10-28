#!/usr/bin/env bash
# cloud.sh — run the Rotavox cloud VM from this machine, through the OCI Bastion
# (the VM has no public IP). The cloud counterpart of tools/rotavox.ps1.
#
# Usage: tools/cloud/cloud.sh <command>
#   status              services, disk and the last backup (waits out first boot)
#   deploy              build and start the committed HEAD; refuses local edits and unpushed commits
#   logs                follow the web app's log
#   ssh [cmd...]        a shell, or one command, on the VM
#   web                 forward the app to http://localhost:13000 to try it out
#   tunnel              hold a bastion session open so the commands above reuse it
#   bootstrap           re-run bootstrap.sh (after editing it)
#   set-tunnel          install the Cloudflare Tunnel connector (prompts for its token)
#   set-backup          store R2 credentials for off-site backups (prompts)
#   backup              take a backup now
#   restore <file>      replace the cloud database with a pg_dump custom-format file
#
# Env (or .env at the repo root): CLOUD_VM_IP (written by provision.sh), and the
# bastion settings in tools/lib/bastion-tunnel.sh. Optional: CLOUD_SSH_PORT
# (default 2223), CLOUD_SSH_KEY (default ~/.ssh/id_rotavox; one set on the
# command line wins over .env).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY_FROM_CALLER=${CLOUD_SSH_KEY:-}
. "$ROOT/tools/lib/bastion-tunnel.sh"
: "${CLOUD_VM_IP:?set CLOUD_VM_IP (tools/cloud/provision.sh writes it)}"
PORT="${CLOUD_SSH_PORT:-2223}"
SSH_KEY="${KEY_FROM_CALLER:-${CLOUD_SSH_KEY:-$HOME/.ssh/id_rotavox}}"

usage() { sed -n '5,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

# Reuse a held session (`cloud.sh tunnel` in another terminal), else open one
# for this command; bastion_tunnel's EXIT trap closes it.
connect() {
  ss -ltn "sport = :$PORT" | grep -q LISTEN || bastion_tunnel 22 "$PORT" "$CLOUD_VM_IP" >&2
}
vm() {
  ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -p "$PORT" -o StrictHostKeyChecking=accept-new \
    -o HostKeyAlias=rotavox-cloud -o ServerAliveInterval=30 "$@"
}
on_vm() { vm ubuntu@localhost "$@"; }

wait_for_bootstrap() {
  until on_vm test -f /var/lib/rotavox-bootstrapped; do
    echo "First boot is still setting up the VM; checking again in 20s..." >&2
    on_vm 'sudo tail -n 3 /var/log/cloud-init-output.log' >&2 || true
    sleep 20
  done
}

COMMAND=${1:-}
[ -n "$COMMAND" ] || usage
shift

case "$COMMAND" in
  tunnel)
    bastion_tunnel 22 "$PORT" "$CLOUD_VM_IP"
    echo "Holding localhost:$PORT -> cloud VM:22; cloud.sh commands in other terminals reuse it."
    bastion_hold
    ;;
  ssh)
    connect
    if [ $# -gt 0 ]; then on_vm "$@"; else vm -t ubuntu@localhost; fi
    ;;
  status)
    connect
    wait_for_bootstrap
    on_vm 'for u in rotavox-web cloudflared postgresql@18-main rotavox-backup.timer; do
        printf "%-22s %s\n" "$u" "$(systemctl is-active "$u")"; done
      echo "Release:               $(if [ -e /opt/rotavox/current ]; then basename "$(readlink -f /opt/rotavox/current)"; else echo none; fi)"
      echo "Last backup:           $(sudo ls -1t /var/backups/rotavox | head -1)"
      echo "Off-site backups:      $(sudo test -f /etc/rotavox/rclone.conf && echo R2 || echo "not set (cloud.sh set-backup)")"
      df -h / | tail -1 | awk "{print \"Disk:                  \" \$3 \" used of \" \$2}"'
    ;;
  deploy)
    cd "$ROOT"
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "This checkout has local edits to tracked files (git status). Commit or discard them first; deploy ships HEAD." >&2
      exit 1
    fi
    # Runners update themselves to the commit the cloud runs, fetching it from GitHub's
    # main (rotavox.ps1 self-update), so the cloud must never run one that isn't there.
    git fetch --quiet origin main
    if ! git merge-base --is-ancestor HEAD origin/main; then
      echo "HEAD isn't on GitHub's main yet. Push it first: Runners update to the commit the cloud runs, from GitHub." >&2
      exit 1
    fi
    SHA=$(git rev-parse --short=12 HEAD)
    echo "Deploying $(git log --oneline -1)"
    connect
    wait_for_bootstrap
    DIR=/opt/rotavox/releases/$SHA
    git archive --format=tar.gz HEAD | on_vm "sudo rm -rf $DIR && sudo mkdir -p $DIR && sudo tar -xz -C $DIR"
    on_vm "cd $DIR && sudo bash tools/cloud/release.sh $SHA"
    ;;
  logs)
    connect
    on_vm 'sudo journalctl -u rotavox-web -n 100 -f'
    ;;
  web)
    connect
    echo "Rotavox on the cloud VM: http://localhost:13000/login (Ctrl-C to stop)."
    echo "Links it builds point at APP_URL (https://app.rotavox.com); before cutover, that's still the box."
    vm -N -L 13000:127.0.0.1:3000 ubuntu@localhost
    ;;
  bootstrap)
    connect
    on_vm 'sudo bash -s' <"$ROOT/tools/cloud/bootstrap.sh"
    ;;
  set-tunnel)
    # The token is the tunnel's credential: read it without echoing, and hand it
    # to the VM on stdin into a root-only file (as the box kept it), so it never
    # sits in a shell history, a process list or a unit file.
    read -r -s -p "Cloudflare Tunnel token (Zero Trust > Networks > Tunnels > the tunnel > Configure): " TOKEN
    echo
    [ -n "$TOKEN" ] || { echo "No token given." >&2; exit 1; }
    connect
    printf '%s' "$TOKEN" | on_vm 'sudo install -d -m 0700 /etc/cloudflared && sudo install -m 0600 /dev/stdin /etc/cloudflared/token'
    on_vm 'sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<UNIT
[Unit]
Description=Cloudflare Tunnel connector for app.rotavox.com
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/token
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
      sudo systemctl daemon-reload && sudo systemctl enable cloudflared && sudo systemctl restart cloudflared &&
      sleep 5 && sudo journalctl -u cloudflared -n 20 --no-pager | grep -E "Registered tunnel connection|ERR"'
    ;;
  set-backup)
    read -r -p "Cloudflare account ID: " ACCOUNT
    read -r -p "R2 bucket: " BUCKET
    read -r -p "R2 access key ID: " KEY_ID
    read -r -s -p "R2 secret access key: " SECRET
    echo
    connect
    printf '[r2]\ntype = s3\nprovider = Cloudflare\naccess_key_id = %s\nsecret_access_key = %s\nendpoint = https://%s.r2.cloudflarestorage.com\nno_check_bucket = true\n' \
      "$KEY_ID" "$SECRET" "$ACCOUNT" |
      on_vm "sudo install -m 0600 /dev/stdin /etc/rotavox/rclone.conf &&
        echo R2_BUCKET=$BUCKET | sudo tee /etc/rotavox/backup.env >/dev/null &&
        sudo rclone --config /etc/rotavox/rclone.conf lsd r2:$BUCKET >/dev/null && echo 'R2 reachable; backups will copy there.'"
    ;;
  backup)
    connect
    on_vm 'sudo systemctl start rotavox-backup && sudo journalctl -u rotavox-backup -n 5 --no-pager'
    ;;
  restore)
    FILE=${1:?usage: cloud.sh restore <file.dump>}
    [ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
    read -r -p "This replaces the cloud database with $FILE. Type restore to go on: " OK
    [ "$OK" = restore ] || exit 1
    connect
    wait_for_bootstrap
    on_vm 'cat >/tmp/rotavox-restore.dump' <"$FILE"
    # Keep a copy of what's being replaced, then load the dump as the app's own role
    # so the app owns every table, then bring the schema up to this release.
    on_vm 'set -e
      sudo systemctl start rotavox-backup
      sudo systemctl stop rotavox-web
      sudo -u postgres dropdb --if-exists rotavox
      sudo -u postgres createdb --owner=rotavox rotavox
      sudo -u postgres psql -q -d rotavox -c "ALTER SCHEMA public OWNER TO rotavox;"
      sudo chmod 0644 /tmp/rotavox-restore.dump
      sudo -u postgres pg_restore --no-owner --no-privileges --role=rotavox --exit-on-error -d rotavox /tmp/rotavox-restore.dump
      rm -f /tmp/rotavox-restore.dump
      if [ -e /opt/rotavox/current ]; then
        cd /opt/rotavox/current
        sudo -u rotavox env HOME=/opt/rotavox bash -c "set -a; . /etc/rotavox/web.env; set +a; npm run migrate -w @rotavox/schema"
        sudo systemctl start rotavox-web
      fi
      echo "Restored."'
    ;;
  *) usage ;;
esac
