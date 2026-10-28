#!/usr/bin/env bash
# provision.sh — create the Rotavox cloud VM on OCI, once. Safe to re-run: each
# resource is looked up by name first and only created if it's missing.
#
# What it makes, all in the broadcast box's VCN:
#   - a NAT gateway and a private subnet (10.0.1.0/24) that allows no public IPs.
#     Nothing on the internet can reach the VM; it reaches out through the NAT,
#     and the public reaches the app only through the Cloudflare Tunnel.
#   - SSH into that subnet only from the Bastion's subnet, so tools/cloud/cloud.sh
#     gets in the same way tools/ssh-bastion.sh reaches the box.
#   - one Ampere A1 VM (2 OCPU / 12 GB, inside the Always Free allowance) running
#     Ubuntu 24.04, set up on first boot by bootstrap.sh.
#
# Usage: tools/cloud/provision.sh
# Env (or .env at the repo root): OCI_BASTION_ID, OCI_REGION as for the bastion
# scripts. Optional: CLOUD_SSH_KEYS (default: ~/.ssh/id_ed25519.pub and
# ~/.ssh/id_claude_ed25519.pub, whichever exist).
# On success it writes CLOUD_VM_IP to .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
: "${OCI_BASTION_ID:?set OCI_BASTION_ID}"

NAME=rotavox-cloud
SHAPE=VM.Standard.A1.Flex
OCPUS=2
MEMORY_GB=12
BOOT_GB=50
SUBNET_CIDR=10.0.1.0/24

step() { printf '\n== %s\n' "$*"; }

# Everything lands where the Bastion lives, so its subnet can reach the VM.
BASTION_SUBNET=$(oci bastion bastion get --bastion-id "$OCI_BASTION_ID" --query 'data."target-subnet-id"' --raw-output)
COMPARTMENT=$(oci network subnet get --subnet-id "$BASTION_SUBNET" --query 'data."compartment-id"' --raw-output)
VCN=$(oci network subnet get --subnet-id "$BASTION_SUBNET" --query 'data."vcn-id"' --raw-output)
BASTION_CIDR=$(oci network subnet get --subnet-id "$BASTION_SUBNET" --query 'data."cidr-block"' --raw-output)
VCN_CIDR=$(oci network vcn get --vcn-id "$VCN" --query 'data."cidr-block"' --raw-output)

# find_named <oci list command...> — the id of the live resource named $NAME, or nothing.
find_named() {
  "$@" --compartment-id "$COMPARTMENT" --all \
    --query "data[?\"display-name\"=='$NAME' && \"lifecycle-state\"!='TERMINATED'] | [0].id" --raw-output 2>/dev/null |
    grep -v '^null$' || true
}

step "NAT gateway"
NAT=$(find_named oci network nat-gateway list --vcn-id "$VCN")
[ -n "$NAT" ] || NAT=$(oci network nat-gateway create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
  --display-name "$NAME" --wait-for-state AVAILABLE --query data.id --raw-output)
echo "$NAT"

step "Route table (everything out through the NAT)"
RT=$(find_named oci network route-table list --vcn-id "$VCN")
[ -n "$RT" ] || RT=$(oci network route-table create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
  --display-name "$NAME" --wait-for-state AVAILABLE --query data.id --raw-output \
  --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$NAT\"}]")
echo "$RT"

step "Security list (SSH from the Bastion's subnet only)"
SL=$(find_named oci network security-list list --vcn-id "$VCN")
[ -n "$SL" ] || SL=$(oci network security-list create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
  --display-name "$NAME" --wait-for-state AVAILABLE --query data.id --raw-output \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
  --ingress-security-rules "[
    {\"source\":\"$BASTION_CIDR\",\"protocol\":\"6\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}},
    {\"source\":\"$VCN_CIDR\",\"protocol\":\"1\",\"isStateless\":false,\"icmpOptions\":{\"type\":3,\"code\":4}}]")
echo "$SL"

step "Private subnet $SUBNET_CIDR"
SUBNET=$(find_named oci network subnet list --vcn-id "$VCN")
[ -n "$SUBNET" ] || SUBNET=$(oci network subnet create --compartment-id "$COMPARTMENT" --vcn-id "$VCN" \
  --display-name "$NAME" --cidr-block "$SUBNET_CIDR" --prohibit-public-ip-on-vnic true \
  --route-table-id "$RT" --security-list-ids "[\"$SL\"]" --dns-label rvcloud \
  --wait-for-state AVAILABLE --query data.id --raw-output)
echo "$SUBNET"

step "VM ($SHAPE, $OCPUS OCPU / $MEMORY_GB GB)"
INSTANCE=$(find_named oci compute instance list)
if [ -z "$INSTANCE" ]; then
  AD=$(oci iam availability-domain list --compartment-id "$COMPARTMENT" --query 'data[0].name' --raw-output)
  IMAGE=$(oci compute image list --compartment-id "$COMPARTMENT" --operating-system "Canonical Ubuntu" \
    --operating-system-version 24.04 --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --limit 1 \
    --query 'data[0].id' --raw-output)
  KEYS=$(mktemp)
  trap 'rm -f "$KEYS"' EXIT
  for k in ${CLOUD_SSH_KEYS:-$HOME/.ssh/id_ed25519.pub $HOME/.ssh/id_claude_ed25519.pub}; do
    [ -f "$k" ] && cat "$k" >>"$KEYS"
  done
  [ -s "$KEYS" ] || { echo "No SSH public keys found (set CLOUD_SSH_KEYS)." >&2; exit 1; }
  # A1 capacity comes and goes; "Out of host capacity" means try again later or another AD.
  INSTANCE=$(oci compute instance launch --compartment-id "$COMPARTMENT" --availability-domain "$AD" \
    --display-name "$NAME" --shape "$SHAPE" \
    --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
    --image-id "$IMAGE" --boot-volume-size-in-gbs "$BOOT_GB" \
    --subnet-id "$SUBNET" --assign-public-ip false --hostname-label "$NAME" \
    --ssh-authorized-keys-file "$KEYS" \
    --user-data-file "$(dirname "$0")/bootstrap.sh" \
    --wait-for-state RUNNING --query data.id --raw-output)
fi
echo "$INSTANCE"

IP=$(oci compute instance list-vnics --instance-id "$INSTANCE" --query 'data[0]."private-ip"' --raw-output)
if grep -q '^CLOUD_VM_IP=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s/^CLOUD_VM_IP=.*/CLOUD_VM_IP=$IP/" "$ENV_FILE"
else
  echo "CLOUD_VM_IP=$IP" >>"$ENV_FILE"
fi

cat <<MSG

VM is running at $IP (CLOUD_VM_IP in .env). First boot installs Postgres, Node and
cloudflared, which takes a few minutes. Then:
  tools/cloud/cloud.sh status      # waits for first boot to finish
  tools/cloud/cloud.sh deploy      # build and start the app
See DEPLOY-CLOUD.md for the Cloudflare steps.
MSG
