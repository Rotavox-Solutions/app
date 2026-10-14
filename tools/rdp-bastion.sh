#!/usr/bin/env bash
# rdp-bastion.sh — open a 3h OCI Bastion port-forwarding session to the broadcast
# box and launch RDP through it. RDP (3389) is closed to the public; the bastion's
# private endpoint is the only source allowed in.
#
# Usage: tools/rdp-bastion.sh [user]    (user overrides RDP_USER)
#
# Needs: oci CLI (configured via `oci setup config`), xfreerdp3, and an SSH key
# pair at $KEY / $KEY.pub. Set the target via env (e.g. in .env, which is
# gitignored) rather than editing this file:
#   OCI_BASTION_ID   bastion OCID (Bastion → details page)
#   RDP_TARGET_IP    Windows instance private IP
#   OCI_REGION       e.g. us-ashburn-1
# Optional: RDP_USER (default broadcast), OCI_BASTION_KEY (default ~/.ssh/oci_bastion),
#           RDP_LOCAL_PORT (default 13389)
set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${OCI_BASTION_ID:?set OCI_BASTION_ID}"
: "${RDP_TARGET_IP:?set RDP_TARGET_IP}"
: "${OCI_REGION:?set OCI_REGION}"
RDP_USER="${1:-${RDP_USER:-broadcast}}"
KEY="${OCI_BASTION_KEY:-$HOME/.ssh/oci_bastion}"
LOCAL_PORT="${RDP_LOCAL_PORT:-13389}"

SID=$(oci bastion session create-port-forwarding \
  --bastion-id "$OCI_BASTION_ID" --target-private-ip "$RDP_TARGET_IP" --target-port 3389 \
  --ssh-public-key-file "$KEY.pub" --session-ttl 10800 \
  --query 'data.id' --raw-output)

echo "Waiting for session to become active..."
until [ "$(oci bastion session get --session-id "$SID" --query 'data."lifecycle-state"' --raw-output)" = ACTIVE ]; do sleep 3; done

# ACTIVE comes back before the bastion host accepts the session's key, so the
# first attempts can fail with "Permission denied (publickey)". Retry until the
# forward is listening rather than launching RDP at a dead port.
TUNNEL=
trap '[ -n "$TUNNEL" ] && kill $TUNNEL 2>/dev/null' EXIT
for attempt in $(seq 1 12); do
  ssh -i "$KEY" -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L "$LOCAL_PORT:$RDP_TARGET_IP:3389" -p 22 "$SID@host.bastion.$OCI_REGION.oci.oraclecloud.com" 2>/dev/null &
  TUNNEL=$!
  for _ in $(seq 1 10); do
    ss -ltn "sport = :$LOCAL_PORT" | grep -q LISTEN && break 2
    kill -0 $TUNNEL 2>/dev/null || break
    sleep 1
  done
  kill $TUNNEL 2>/dev/null || true
  TUNNEL=
  echo "Tunnel not up yet (attempt $attempt/12), retrying..."
  sleep 5
done
[ -n "$TUNNEL" ] || { echo "Could not open the bastion tunnel." >&2; exit 1; }

xfreerdp3 /v:localhost:"$LOCAL_PORT" /u:"$RDP_USER" /sec:nla /cert:ignore
