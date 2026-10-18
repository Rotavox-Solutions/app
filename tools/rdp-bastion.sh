#!/usr/bin/env bash
# rdp-bastion.sh — open a 3h OCI Bastion port-forwarding session to the broadcast
# box and open it in Remmina. RDP (3389) is closed to the public; the bastion's
# private endpoint is the only source allowed in. For SSH/SFTP alongside it,
# run tools/ssh-bastion.sh in another terminal.
#
# Usage: tools/rdp-bastion.sh [--save-password] [user]    (user overrides RDP_USER)
#
# Passwords are kept by Remmina, encrypted in the desktop keyring, never in this
# repo or .env. Either pass --save-password (prompts here, then connects) or tick
# "Save password" in Remmina's login prompt. To change or clear it, edit the
# "OCI - clubfm (<user>, via bastion)" profile in Remmina.
#
# Needs: oci CLI (configured via `oci setup config`), remmina, and the bastion
# SSH key. Target and key settings: see tools/lib/bastion-tunnel.sh.
# Optional: RDP_USER (default broadcast), RDP_LOCAL_PORT (default 13389)
set -euo pipefail

. "$(dirname "$0")/lib/bastion-tunnel.sh"

SAVE_PASSWORD=0
if [ "${1:-}" = --save-password ]; then SAVE_PASSWORD=1; shift; fi
RDP_USER="${1:-${RDP_USER:-broadcast}}"
LOCAL_PORT="${RDP_LOCAL_PORT:-13389}"

# The profile lives with Remmina's own (so it shows in Remmina's list) and is
# created once, then only updated: rewriting it would drop the saved password,
# which Remmina keys to this file. The public-IP profiles no longer connect; the
# tunnel's local port is the only way in.
# sound=remote keeps audio on the server: playout goes to the virtual audio cable
# there, and a session that redirects audio (or drops it) hides that device. It
# is re-asserted every run, as is the server, in case either was edited.
# scale=2 is Remmina's dynamic resolution mode.
PROFILE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/remmina"
PROFILE="$PROFILE_DIR/rdp-bastion-$RDP_USER.remmina"
# Re-asserted keys are edited in place rather than through remmina
# --update-profile, which loads and re-saves every field and blanked the saved
# password marker (password=.) in testing.
profile_set() {
  local key=$1 value=$2
  if grep -q "^$key=" "$PROFILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$PROFILE"
  else
    echo "$key=$value" >> "$PROFILE"
  fi
}

if [ ! -f "$PROFILE" ]; then
  mkdir -p "$PROFILE_DIR"
  cat > "$PROFILE" <<PROFILE_EOF
[remmina]
name=OCI - clubfm ($RDP_USER, via bastion)
group=OCI
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
fi
profile_set server "localhost:$LOCAL_PORT"
profile_set username "$RDP_USER"
profile_set sound remote

if [ "$SAVE_PASSWORD" = 1 ]; then
  read -rsp "Password for $RDP_USER (saved to the keyring by Remmina): " PW; echo
  # Remmina reads the value of a bare --set-option from stdin and encrypts it.
  printf '%s\n' "$PW" | remmina --update-profile "$PROFILE" --set-option password >/dev/null 2>&1
  unset PW
  echo "Saved."
fi

bastion_tunnel 3389 "$LOCAL_PORT"

# remmina -c returns at once when Remmina is already running (it hands the
# profile to that instance), so the tunnel can't be tied to its exit. Hold it
# open here instead; it also ends on its own when the bastion session expires.
remmina -c "$PROFILE" >/dev/null 2>&1 &
echo "Tunnel up on localhost:$LOCAL_PORT. Remmina is opening (if it asks for the password, type it promptly)."
bastion_hold
