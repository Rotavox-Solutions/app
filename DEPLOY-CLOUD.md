# Rotavox in the cloud (step 4 of the cloud split)

The web app and its Postgres move off the broadcast box to one OCI VM. The Runner
stays on the box and reaches Rotavox at `https://app.rotavox.com` through the Runner
API (ADR-0004). The Runner's local log copy (ADR-0004 §6) keeps the station on air
while Rotavox is down, so a VM reboot, deploy or the cutover below never reaches air.

| Piece | Where | Cost |
| --- | --- | --- |
| VM: Next.js + Postgres 18 | OCI, Ampere A1, 2 OCPU / 12 GB, Ubuntu 24.04 | Always Free compute; the 50 GB disk is ~$1–2/month, because the tenancy's volumes already pass the 200 GB free storage |
| Way in for the public | Cloudflare Tunnel to `127.0.0.1:3000` | Free |
| TLS, DNS, DDoS, static-asset caching | Cloudflare | Free |
| Sign-in rate limit | Cloudflare WAF rate-limiting rule | Free (one rule) |
| Off-site backups | Cloudflare R2 | Free under 10 GB |
| Admin access (SSH) | OCI Bastion, as for the box | Free |

The VM has no public IP and its subnet allows SSH only from the Bastion's subnet.
Nothing on it listens beyond localhost; the only way in from the internet is the
tunnel, which the VM dials out to.

All commands below run from the repo root on an admin machine with the `oci` CLI and
the Bastion settings in `.env` (see `tools/lib/bastion-tunnel.sh`).

## 1. Create the VM

```
tools/cloud/provision.sh
tools/cloud/cloud.sh status      # waits until first boot (bootstrap.sh) finishes
tools/cloud/cloud.sh deploy      # builds and starts the committed HEAD
```

`provision.sh` is safe to re-run and writes `CLOUD_VM_IP` to `.env`. If OCI answers
"Out of host capacity", A1 is full in that availability domain right now; try later.

Each command opens its own Bastion session (about 30 s). For a run of commands, hold
one open in another terminal with `tools/cloud/cloud.sh tunnel`.

## 2. Cloudflare (dashboard, once)

**Off-site backups (R2).** R2 → Create bucket `rotavox-backups`. Then R2 → Manage API
tokens → Create, with *Object Read & Write* on that bucket only. Then:

```
tools/cloud/cloud.sh set-backup   # account ID, bucket, key ID, secret
tools/cloud/cloud.sh backup       # proves it end to end
```

A nightly dump runs at 10:00 UTC. The VM keeps the last 14 on disk; R2 keeps 60 days.

**Rate-limit sign-in.** Security → WAF → Rate limiting rules → Create: URI Path equals
`/api/auth/login` and Request Method equals `POST`, more than 5 requests per 10 seconds
from one IP → Block. Nothing in the app limits password guesses, and scrypt makes each
guess cost the VM CPU.

**SSL/TLS.** Edge Certificates: *Always Use HTTPS* on, *Minimum TLS* 1.2.

**Leave these off.** *Bot Fight Mode* and *Under Attack Mode* challenge every
non-browser request, and the Runner is one, so its reports would stop. (It would keep
pacing from its copy, but nothing it played would reach Rotavox.) Don't add a *Cache
Everything* rule: pages are per-user. Cloudflare already caches `/_next/static`.

The tunnel itself is the one `app.rotavox.com` uses today. It moves at cutover (§4);
there is no DNS change.

## 3. Rehearse with a copy of BOLT

This leaves the box untouched. On the box (SSH via `tools/ssh-bastion.sh`):

```
pg_dump -Fc -h localhost -U rotavox -d rotavox -f $env:TEMP\rotavox.dump
```

Copy it here (`scp -P 2222 opc@localhost:<path> .`), then:

```
tools/cloud/cloud.sh restore rotavox.dump
tools/cloud/cloud.sh web          # http://localhost:13000/login, sign in as usual
```

Pages, logs and the Library should match the box. Links the app builds, such as
invitations, point at `APP_URL`, which is still the box until cutover.

## 4. Cutover

Pick a quiet time with no PD editing. BOLT stays on air throughout: the Runner paces
from its log copy and queues its reports until Rotavox answers again.

1. On the box, stop the web app: `Stop-Service RotavoxWeb`. From here, nothing writes
   to the box database.
2. Dump it, copy the dump here, and restore it: as in §3, then
   `tools/cloud/cloud.sh restore rotavox.dump`.
3. Move the tunnel. Stop the connector on the box, then in Zero Trust → Networks →
   Tunnels → the `app.rotavox.com` tunnel → Configure, copy the token from the install
   command and run `tools/cloud/cloud.sh set-tunnel`. Only the VM's connector should be
   left listed as healthy.
4. Sign in at `https://app.rotavox.com`.
5. On the box, check the Runner's `ROTAVOX_API_URL` is `https://app.rotavox.com`
   (change it and restart the Runner if it points at the box). Its log should show
   `[log-copy] Rotavox is reachable again` and the waiting reports draining.
6. Keep the box from starting its web app again: `Set-Service RotavoxWeb -StartupType Disabled`.
   Keep the box's Postgres for a couple of weeks as a fallback, then retire it.

**To roll back** before any PD works in the cloud: stop the VM's connector
(`cloud.sh ssh sudo systemctl stop cloudflared`), start the box's connector and
`RotavoxWeb` again. Anything done in the cloud after the cutover would be lost, so
past that point, roll forward instead.

## Day to day

```
tools/cloud/cloud.sh deploy       # ship the committed HEAD (refuses local edits)
tools/cloud/cloud.sh status
tools/cloud/cloud.sh logs
```

A deploy builds the new release beside the live one in `/opt/rotavox/releases/<sha>`,
migrates, switches the `current` symlink and restarts. If `/login` doesn't answer
within a minute, it switches back. The three newest releases are kept. Security
updates install automatically; reboots wait for a human (`cloud.sh ssh sudo reboot`).
