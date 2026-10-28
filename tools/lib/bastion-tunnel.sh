# bastion-tunnel.sh — sourced by tools/*-bastion.sh and tools/cloud/cloud.sh.
# Opens an OCI Bastion port-forwarding session to one port on the broadcast box
# (or the Rotavox cloud VM) and holds an SSH tunnel to it on a local port. A
# session reaches exactly one target port, so RDP and SSH each need their own;
# both can be open at once.
#
# Env (or .env at the repo root, which is gitignored):
#   OCI_BASTION_ID   bastion OCID (Bastion → details page)
#   RDP_TARGET_IP    broadcast box private IP (used for every port, not only RDP)
#   CLOUD_VM_IP      Rotavox cloud VM private IP (tools/cloud; written by provision.sh)
#   OCI_REGION       e.g. us-phoenix-1
#   OCI_BASTION_KEY  optional, default ~/.ssh/oci_bastion (needs the .pub beside it)

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/../../.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

: "${OCI_BASTION_ID:?set OCI_BASTION_ID}"
: "${RDP_TARGET_IP:=}"
: "${OCI_REGION:?set OCI_REGION}"
KEY="${OCI_BASTION_KEY:-$HOME/.ssh/oci_bastion}"

# bastion_tunnel <target port> <local port> [target ip]
# The target defaults to the broadcast box. On return, TUNNEL is the pid of the
# ssh holding the forward; an EXIT trap kills it.
bastion_tunnel() {
  local target_port=$1 local_port=$2 target_ip=${3:-$RDP_TARGET_IP} sid attempt
  [ -n "$target_ip" ] || { echo "set RDP_TARGET_IP" >&2; exit 1; }

  # A forward already listening here (another run still open) would pass the
  # readiness check below while this run's ssh fails to bind.
  if ss -ltn "sport = :$local_port" | grep -q LISTEN; then
    echo "localhost:$local_port is already in use (another tunnel still open?)." >&2
    exit 1
  fi

  sid=$(oci bastion session create-port-forwarding \
    --bastion-id "$OCI_BASTION_ID" --target-private-ip "$target_ip" --target-port "$target_port" \
    --ssh-public-key-file "$KEY.pub" --session-ttl 10800 \
    --query 'data.id' --raw-output)

  echo "Waiting for session to become active..."
  until [ "$(oci bastion session get --session-id "$sid" --query 'data."lifecycle-state"' --raw-output)" = ACTIVE ]; do sleep 3; done

  # ACTIVE comes back before the bastion host accepts the session's key, so the
  # first attempts can fail with "Permission denied (publickey)". Retry until the
  # forward is listening rather than handing a client a dead port.
  TUNNEL=
  trap '[ -n "$TUNNEL" ] && kill $TUNNEL 2>/dev/null' EXIT
  for attempt in $(seq 1 12); do
    ssh -i "$KEY" -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
      -L "$local_port:$target_ip:$target_port" -p 22 "$sid@host.bastion.$OCI_REGION.oci.oraclecloud.com" 2>/dev/null &
    TUNNEL=$!
    for _ in $(seq 1 10); do
      ss -ltn "sport = :$local_port" | grep -q LISTEN && return 0
      kill -0 $TUNNEL 2>/dev/null || break
      sleep 1
    done
    kill $TUNNEL 2>/dev/null || true
    TUNNEL=
    echo "Tunnel not up yet (attempt $attempt/12), retrying..."
    sleep 5
  done
  echo "Could not open the bastion tunnel." >&2
  exit 1
}

# Hold the tunnel until Ctrl-C; it also ends on its own when the session expires.
bastion_hold() {
  echo "Press Ctrl-C here to close the tunnel when you're done."
  wait "$TUNNEL" || true
}
