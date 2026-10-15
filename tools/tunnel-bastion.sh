#!/usr/bin/env bash
# tunnel-bastion.sh — open a 3h OCI Bastion port-forwarding session to any port
# on the broadcast box and hold it on a local port until Ctrl-C. The RDP and SSH
# scripts are this plus a client; use this one for anything else (e.g. 3306 for
# RadioDJ's MariaDB). Each run is its own bastion session, so several can be
# open at once on different local ports.
#
# Usage: tools/tunnel-bastion.sh <port> [local port]
#   local port defaults to port + 10000 (3306 -> 13306), so it doesn't collide
#   with a service of the same kind on this machine; ports above 55535 need it
#   given explicitly.
#
# Needs: oci CLI, the bastion SSH key, and the port allowed from the bastion's
# private IP (OCI security list/NSG and Windows Firewall). Target and key
# settings: see tools/lib/bastion-tunnel.sh.
set -euo pipefail

usage() { echo "Usage: $0 <port> [local port]" >&2; exit 2; }
valid_port() { [[ $1 =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }

[ $# -ge 1 ] && [ $# -le 2 ] || usage
TARGET_PORT=$1
valid_port "$TARGET_PORT" || { echo "Not a port: $TARGET_PORT" >&2; usage; }
if [ $# -eq 2 ]; then
  LOCAL_PORT=$2
  valid_port "$LOCAL_PORT" || { echo "Not a port: $LOCAL_PORT" >&2; usage; }
elif [ "$TARGET_PORT" -le 55535 ]; then
  LOCAL_PORT=$((TARGET_PORT + 10000))
else
  echo "Port $TARGET_PORT + 10000 is out of range; give a local port." >&2
  usage
fi

. "$(dirname "$0")/lib/bastion-tunnel.sh"

bastion_tunnel "$TARGET_PORT" "$LOCAL_PORT"

echo "Tunnel up: localhost:$LOCAL_PORT -> broadcast box:$TARGET_PORT"
bastion_hold
