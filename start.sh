#!/bin/bash
# ServerDash production start script — runs all panel services under PM2 and Nginx

echo -e "\e[36m"
echo "=========================================================="
echo "   ⚡ Starting ServerDash Panel Production Services ⚡"
echo "=========================================================="
echo -e "\e[0m"

# ── Load env ──────────────────────────────────────────────────
if [ -f "/root/ServerDash/backend/.env" ]; then
  set -a
  source /root/ServerDash/backend/.env
  set +a
fi

# ── Detect public IP ──────────────────────────────────────────
HOST_IP=$(curl -4 -s --max-time 5 api.ipify.org 2>/dev/null)
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null)
fi
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | grep -v '^172\.17\.' | head -n 1)
fi
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
fi

BACKEND_PORT="${PORT:-4001}"

# ── 1. Build frontend if dist is missing ──────────────────────
if [ ! -f "/root/ServerDash/frontend/dist/index.html" ]; then
  echo "📦 Production assets missing. Compiling frontend..."
  cd /root/ServerDash/frontend && npm run build
  echo "✅ Frontend built."
else
  echo "📦 Frontend dist already exists — skipping build."
fi

# ── 2. Sync assets to Nginx web root ──────────────────────────
echo "📂 Syncing static assets to /var/www/serverdash/dist..."
mkdir -p /var/www/serverdash/dist
rsync -a --delete /root/ServerDash/frontend/dist/ /var/www/serverdash/dist/
chown -R www-data:www-data /var/www/serverdash
chmod -R 755 /var/www/serverdash
echo "✅ Assets synced."

# ── 3. Ensure Nginx config is enabled ────────────────────────
echo "🌐 Configuring Nginx..."
ln -sf /etc/nginx/sites-available/serverdash /etc/nginx/sites-enabled/serverdash

# Remove default conflicting config if present
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t && systemctl reload nginx || systemctl restart nginx
echo "✅ Nginx running."

# ── 4. Start backend under PM2 ───────────────────────────────
echo "⚡ Starting Node.js backend under PM2..."
cd /root/ServerDash/backend

# Stop old instance if running
pm2 delete serverdash-backend &>/dev/null || true

# Start fresh
pm2 start server.js \
  --name "serverdash-backend" \
  --log /root/ServerDash/backend/logs/pm2.log \
  --error /root/ServerDash/backend/logs/pm2-error.log \
  --time

pm2 save
echo "✅ Backend started."

# ── 5. Health verification ────────────────────────────────────
echo ""
echo "⏳ Waiting for services to come online..."
sleep 10

HEALTH_RESPONSE=$(curl -sf --max-time 5 "http://localhost:${BACKEND_PORT}/api/health" 2>/dev/null || echo "")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
  BACKEND_STATUS="\e[32mRUNNING\e[0m (Port ${BACKEND_PORT})"
else
  BACKEND_STATUS="\e[31mFAILED\e[0m — run: pm2 logs serverdash-backend"
fi

NGINX_STATUS=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "000")
if [[ "$NGINX_STATUS" =~ ^(200|301|302)$ ]]; then
  NGINX_DISP="\e[32mRUNNING\e[0m (Port 80)"
else
  NGINX_DISP="\e[31mFAILED\e[0m — run: journalctl -u nginx --no-pager -n 20"
fi

echo -e "\n\e[32m"
echo "=========================================================="
echo "    🎉 SERVERDASH PANEL BOOTED SUCCESSFULLY! 🎉"
echo "==========================================================\e[0m"
echo ""
echo -e "✅ Backend API:  ${BACKEND_STATUS}"
echo -e "✅ Nginx Server: ${NGINX_DISP}"
echo ""
echo -e "🌐 \e[1mPanel URL\e[0m:       \e[36mhttp://$HOST_IP\e[0m"
echo -e "🔐 \e[1mAdmin Email\e[0m:     \e[36m${ADMIN_EMAIL:-admin@serverdash.local}\e[0m"
echo -e "🔑 \e[1mAdmin Password\e[0m:  \e[33m${ADMIN_PASSWORD:-(check /root/ServerDash/backend/.env)}\e[0m"
echo "=========================================================="
echo ""
