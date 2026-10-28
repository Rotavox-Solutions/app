#!/usr/bin/env bash
# bootstrap.sh — set up the Rotavox cloud VM (Ubuntu 24.04, arm64). provision.sh
# hands this to cloud-init as user-data, so it runs as root on first boot; it is
# also safe to re-run (`tools/cloud/cloud.sh bootstrap`) after editing it.
#
# Installs Postgres 17, Node 24 and cloudflared, and lays out:
#   /opt/rotavox/releases/<sha>   one directory per deploy (release.sh)
#   /opt/rotavox/current          symlink to the live release
#   /etc/rotavox/web.env          the app's env, incl. the generated DB password
#   /etc/rotavox/rclone.conf      R2 credentials for off-site backups (cloud.sh set-backup),
#                                 with the bucket name in /etc/rotavox/backup.env
#   /var/backups/rotavox          nightly pg_dumps, 14 kept on disk
# Nothing listens beyond localhost: the app binds 127.0.0.1:3000 and is reached
# only through the Cloudflare Tunnel.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_ORIGIN=https://app.rotavox.com
NODE_MAJOR=24
PG_MAJOR=17

apt-get update
apt-get install -y ca-certificates curl gnupg postgresql-common rclone

# Postgres from PGDG, so the major version is ours to choose rather than the release's.
[ -f /etc/apt/sources.list.d/pgdg.list ] || [ -f /etc/apt/sources.list.d/pgdg.sources ] ||
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y

install -d -m 0755 /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
fi
if [ ! -f /etc/apt/keyrings/cloudflare.gpg ]; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg -o /etc/apt/keyrings/cloudflare.gpg ||
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /etc/apt/keyrings/cloudflare.gpg
  echo "deb [signed-by=/etc/apt/keyrings/cloudflare.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    >/etc/apt/sources.list.d/cloudflared.list
fi
apt-get update
apt-get install -y "postgresql-$PG_MAJOR" nodejs cloudflared unattended-upgrades

# Security updates install themselves; a reboot they need waits for a human, so
# the app is never restarted under a PD unannounced.
systemctl enable --now unattended-upgrades

id rotavox >/dev/null 2>&1 || useradd --system --home-dir /opt/rotavox --shell /usr/sbin/nologin rotavox
install -d -o rotavox -g rotavox -m 0755 /opt/rotavox /opt/rotavox/releases
install -d -o root -g rotavox -m 0750 /etc/rotavox
install -d -o postgres -g postgres -m 0700 /var/backups/rotavox

# The database and its role. The password is made once and lives only in web.env.
if [ ! -f /etc/rotavox/web.env ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  cat >/etc/rotavox/web.env <<ENV
DATABASE_URL=postgresql://rotavox:$DB_PASSWORD@127.0.0.1:5432/rotavox
APP_URL=$APP_ORIGIN
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
ENV
  chown root:rotavox /etc/rotavox/web.env
  chmod 0640 /etc/rotavox/web.env
fi
DB_PASSWORD=$(sed -n 's|^DATABASE_URL=postgresql://rotavox:\([^@]*\)@.*|\1|p' /etc/rotavox/web.env)
sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE rotavox LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rotavox') \gexec
ALTER ROLE rotavox PASSWORD :'pw';
SELECT 'CREATE DATABASE rotavox OWNER rotavox' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rotavox') \gexec
SQL
# Since PG15 a non-owner has no CREATE on public (DEPLOY.md §3).
sudo -u postgres psql -v ON_ERROR_STOP=1 -d rotavox -c "ALTER SCHEMA public OWNER TO rotavox;"

cat >/etc/systemd/system/rotavox-web.service <<'UNIT'
[Unit]
Description=Rotavox web app
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=rotavox
Group=rotavox
WorkingDirectory=/opt/rotavox/current/apps/web
EnvironmentFile=/etc/rotavox/web.env
ExecStart=/usr/bin/node /opt/rotavox/current/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/rotavox/current/apps/web/.next

[Install]
WantedBy=multi-user.target
UNIT

# Nightly dump: always to local disk, and to Cloudflare R2 once set-backup has
# written rclone.conf, so a lost VM or OCI account doesn't take the data with it.
cat >/usr/local/bin/rotavox-backup <<'SH'
#!/usr/bin/env bash
set -euo pipefail
file=/var/backups/rotavox/rotavox-$(date -u +%Y%m%dT%H%M%SZ).dump
sudo -u postgres pg_dump --format=custom --dbname=rotavox --file="$file"
ls -1t /var/backups/rotavox/rotavox-*.dump | tail -n +15 | xargs -r rm --
if [ -f /etc/rotavox/rclone.conf ]; then
  . /etc/rotavox/backup.env
  rclone --config /etc/rotavox/rclone.conf copyto "$file" "r2:$R2_BUCKET/$(basename "$file")"
  rclone --config /etc/rotavox/rclone.conf delete --min-age 60d "r2:$R2_BUCKET"
fi
echo "Backed up to $file"
SH
chmod 0755 /usr/local/bin/rotavox-backup

cat >/etc/systemd/system/rotavox-backup.service <<'UNIT'
[Unit]
Description=Rotavox database backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/rotavox-backup
UNIT
cat >/etc/systemd/system/rotavox-backup.timer <<'UNIT'
[Unit]
Description=Nightly Rotavox database backup

[Timer]
OnCalendar=*-*-* 10:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable rotavox-web.service
systemctl enable --now rotavox-backup.timer
touch /var/lib/rotavox-bootstrapped
echo "Rotavox bootstrap done."
