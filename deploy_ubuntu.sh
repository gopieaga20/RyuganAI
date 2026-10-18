#!/usr/bin/env bash
# ------------------------------------------------------------------
# Ryugan AI — server deployment for Ubuntu 24.04 (built for Oracle Cloud Always Free)
#
# Run on the server, from inside the cloned repo:
#   sudo DOMAIN=yourname.duckdns.org LE_EMAIL=you@example.com bash deploy_ubuntu.sh
#
# Optional variables:
#   AUTH_USER=admin        web login username (default: admin)
#   RESET_PASSWORD=1       ask for a new web login password even if one exists
#
# What it sets up: Postgres (random DB password) -> Python venv -> systemd service
# (uvicorn on 127.0.0.1:8000) -> nginx reverse proxy with a password prompt and
# WebSocket support -> free HTTPS from Let's Encrypt -> fail2ban -> daily DB backup.
# Safe to re-run: it updates things in place and keeps your existing .env values.
#
# BEFORE running: (1) open ports 80 and 443 in the Oracle VCN security list,
# (2) point your DuckDNS name at this server's public IP.
# AFTER running: put your Angel One / Anthropic keys in backend/.env, then
#   sudo systemctl restart ryugan
# ------------------------------------------------------------------
set -euo pipefail

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo DOMAIN=... LE_EMAIL=... bash deploy_ubuntu.sh"
: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=yourname.duckdns.org}"
: "${LE_EMAIL:?Set LE_EMAIL to your email address for certificate expiry notices}"
AUTH_USER="${AUTH_USER:-admin}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-}"
[ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ] || die "Run via sudo from a normal user (e.g. ubuntu), not as root directly."
[ -f "$APP_DIR/backend/main.py" ] || die "Run this from the repo root (backend/main.py not found in $APP_DIR)."

DB_NAME="trading_app"
DB_USER="trading_user"
ENV_FILE="$APP_DIR/backend/.env"
HTPASSWD_FILE="/etc/nginx/.htpasswd-ryugan"

# ---- 0. Swap (the 1 GB Always Free micro VMs run out of memory without it) ----
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 1500 ] && [ -z "$(swapon --show --noheadings)" ]; then
  say "Low memory (${MEM_MB} MB): creating a 2 GB swap file"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- 1. Packages ----
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | debconf-set-selections
apt-get update -y
apt-get install -y python3-venv python3-pip git nginx postgresql postgresql-contrib \
  certbot python3-certbot-nginx apache2-utils fail2ban iptables-persistent curl

python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || die "Python 3.11+ is required (found $(python3 --version)). Use an Ubuntu 24.04 image."

# ---- 2. Host firewall: Oracle's Ubuntu images block everything except SSH by default ----
say "Opening ports 80 and 443 in the host firewall"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
netfilter-persistent save >/dev/null

# ---- 3. Postgres ----
say "Setting up Postgres"
systemctl enable --now postgresql
cd /tmp   # so the postgres user isn't started from a directory it can't read

# Keep the existing DB password on re-runs so .env and the database stay in sync.
DB_PASS=""
if [ -f "$ENV_FILE" ]; then
  DB_PASS="$(sed -n "s#^DATABASE_URL=postgresql://${DB_USER}:\([^@]*\)@.*#\1#p" "$ENV_FILE" | head -n1)"
fi
[ -n "$DB_PASS" ] || DB_PASS="$(openssl rand -hex 16)"

runuser -u postgres -- psql -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || runuser -u postgres -- createdb -O "${DB_USER}" "${DB_NAME}"

# ---- 4. App config (.env) — your secrets stay here, never in git ----
say "Writing backend/.env settings"
[ -f "$ENV_FILE" ] || cp "$APP_DIR/backend/.env.example" "$ENV_FILE"
set_env() {  # set_env KEY VALUE  (replace the line if present, else append)
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
set_env DATABASE_URL "postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
set_env ALLOWED_ORIGINS "https://${DOMAIN}"
chown "$RUN_USER:$RUN_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---- 5. Python environment ----
say "Creating the Python environment and installing dependencies"
sudo -u "$RUN_USER" python3 -m venv "$APP_DIR/.venv"
sudo -u "$RUN_USER" "$APP_DIR/.venv/bin/pip" install -q --upgrade pip
sudo -u "$RUN_USER" "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

# ---- 6. systemd service ----
say "Installing the systemd service"
cat > /etc/systemd/system/ryugan.service <<UNIT
[Unit]
Description=Ryugan AI trading app (FastAPI)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=${RUN_USER}
WorkingDirectory=${APP_DIR}/backend
# One worker only: the SL/TP watcher and the Angel session live in this process.
ExecStart=${APP_DIR}/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ryugan >/dev/null
systemctl restart ryugan

# ---- 7. Web login (nginx basic auth) ----
if [ ! -f "$HTPASSWD_FILE" ] || [ "${RESET_PASSWORD:-0}" = "1" ]; then
  say "Choose a password for the web login (username: ${AUTH_USER})"
  htpasswd -c "$HTPASSWD_FILE" "$AUTH_USER"
fi
chown root:www-data "$HTPASSWD_FILE"
chmod 640 "$HTPASSWD_FILE"

# ---- 8. nginx ----
say "Configuring nginx"
cat > /etc/nginx/conf.d/ryugan-websocket.conf <<'NGINX'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
NGINX

cat > /etc/nginx/sites-available/ryugan <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    client_max_body_size 1m;

    # Liveness check only (returns {"status":"ok"}) — no password so monitors can ping it.
    location = /api/health {
        auth_basic off;
        proxy_pass http://127.0.0.1:8000;
    }

    location / {
        auth_basic "Ryugan AI";
        auth_basic_user_file /etc/nginx/.htpasswd-ryugan;

        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;   # keep the live-price WebSocket open
    }
}
NGINX
sed -i "s#__DOMAIN__#${DOMAIN}#g" /etc/nginx/sites-available/ryugan
ln -sf /etc/nginx/sites-available/ryugan /etc/nginx/sites-enabled/ryugan
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null
systemctl reload nginx

# ---- 9. HTTPS (Let's Encrypt) — only if the DNS name already points at this server ----
say "Requesting an HTTPS certificate"
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" = "$DNS_IP" ]; then
  certbot --nginx -d "$DOMAIN" -m "$LE_EMAIL" --agree-tos --no-eff-email --non-interactive --redirect \
    || warn "certbot failed — check that ports 80/443 are open in the Oracle VCN security list, then re-run this script."
else
  warn "$DOMAIN resolves to '${DNS_IP:-nothing}' but this server's public IP is '${PUBLIC_IP:-unknown}'."
  warn "Fix the DuckDNS record, then re-run this script to get HTTPS. Until then the site is HTTP only — don't log in over it."
fi

# ---- 10. Brute-force protection for the web login and SSH ----
say "Enabling fail2ban"
cat > /etc/fail2ban/jail.d/ryugan.local <<'F2B'
[sshd]
enabled = true

[nginx-http-auth]
enabled = true
F2B
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban

# ---- 11. Daily database backup (kept for 7 days) ----
say "Installing the daily database backup"
cat > /etc/cron.daily/ryugan-backup <<BACKUP
#!/bin/sh
mkdir -p /var/backups/ryugan
runuser -u postgres -- pg_dump ${DB_NAME} | gzip > /var/backups/ryugan/${DB_NAME}-\$(date +%F).sql.gz
find /var/backups/ryugan -name '*.sql.gz' -mtime +7 -delete
BACKUP
chmod +x /etc/cron.daily/ryugan-backup

# ---- 12. Verify ----
say "Checking the app is up"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ "${OK:-0}" = "1" ] || { journalctl -u ryugan -n 30 --no-pager; die "The app did not start — see the log above."; }

if ! grep -Eq '^ANGEL_API_KEY=.+' "$ENV_FILE"; then
  warn "Angel One credentials are not set yet — the app runs on Yahoo data until you add them."
fi

cat <<DONE

Deployed.  https://${DOMAIN}   (login: ${AUTH_USER})

Next steps:
  1. Add your keys:   nano ${ENV_FILE}     (ANGEL_*, ANTHROPIC_API_KEY)
  2. Apply them:      sudo systemctl restart ryugan
  3. Watch the log:   journalctl -u ryugan -f
  4. Update later:    git pull && sudo systemctl restart ryugan
DONE
