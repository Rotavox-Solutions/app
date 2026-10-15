#!/usr/bin/env bash
# rdp-bastion.sh — open a 3h OCI Bastion port-forwarding session to the broadcast
# box and open it in Remmina. RDP (3389) is closed to the public; the bastion's
# private endpoint is the only source allowed in. For SSH/SFTP alongside it,
# run tools/ssh-bastion.sh in another terminal.
#
# Usage: tools/rdp-bastion.sh [user]    (user overrides RDP_USER)
#
# Needs: oci CLI (configured via `oci setup config`), remmina, and the bastion
# SSH key. Target and key settings: see tools/lib/bastion-tunnel.sh.
# Optional: RDP_USER (default broadcast), RDP_LOCAL_PORT (default 13389)
set -euo pipefail

. "$(dirname "$0")/lib/bastion-tunnel.sh"

RDP_USER="${1:-${RDP_USER:-broadcast}}"
LOCAL_PORT="${RDP_LOCAL_PORT:-13389}"

bastion_tunnel 3389 "$LOCAL_PORT"

# The profile is regenerated every run because the tunnel's local port is the only
# way in; a saved profile pointing at the public IP no longer connects.
# sound=remote keeps audio on the server: playout goes to the virtual audio cable
# there, and a session that redirects audio (or drops it) hides that device.
# scale=2 is Remmina's dynamic resolution mode.
PROFILE="${XDG_RUNTIME_DIR:-/tmp}/rdp-bastion-$RDP_USER.remmina"
cat > "$PROFILE" <<PROFILE_EOF
[remmina]
name=CLUBFM broadcast box ($RDP_USER, via bastion)
protocol=RDP
server=localhost:$LOCAL_PORT
username=$RDP_USER
domain=
security=
cert_ignore=1
ignore-tls-errors=1
sound=remote
scale=2
resolution_mode=2
window_maximize=1
viewmode=1
colordepth=99
network=none
multitransport=0
PROFILE_EOF

# remmina -c returns at once when Remmina is already running (it hands the
# profile to that instance), so the tunnel can't be tied to its exit. Hold it
# open here instead; it also ends on its own when the bastion session expires.
remmina -c "$PROFILE" >/dev/null 2>&1 &
echo "Tunnel up on localhost:$LOCAL_PORT. Remmina is opening; type the password promptly."
bastion_hold
