#!/usr/bin/env bash
# ssh-bastion.sh — open a 3h OCI Bastion port-forwarding session to the broadcast
# box's OpenSSH server (22) and hold it on a local port, for ssh/sftp/scp. Runs
# alongside tools/rdp-bastion.sh: each bastion session reaches one port, so RDP
# and SSH are separate sessions on separate local ports.
#
# Usage: tools/ssh-bastion.sh [user]    (user only shapes the printed commands)
#
# Needs: oci CLI, the bastion SSH key, sshd running on the box, and TCP 22 allowed
# from the bastion's private IP. Target and key settings: see
# tools/lib/bastion-tunnel.sh.
# Optional: SSH_USER (default opc), SSH_LOCAL_PORT (default 2222)
set -euo pipefail

. "$(dirname "$0")/lib/bastion-tunnel.sh"

SSH_USER="${1:-${SSH_USER:-opc}}"
LOCAL_PORT="${SSH_LOCAL_PORT:-2222}"

bastion_tunnel 22 "$LOCAL_PORT"

cat <<MSG
Tunnel up on localhost:$LOCAL_PORT. In another terminal:
  ssh  -p $LOCAL_PORT $SSH_USER@localhost
  sftp -P $LOCAL_PORT $SSH_USER@localhost
  file manager: sftp://$SSH_USER@localhost:$LOCAL_PORT/
MSG
bastion_hold
