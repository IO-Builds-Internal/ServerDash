#!/bin/bash
# ServerDash production start script — runs all panel services under PM2 and Nginx

echo -e "\e[36m"
echo "=========================================================="
echo "   ⚡ Starting ServerDash Panel Production Services ⚡"
echo "=========================================================="
echo -e "\e[0m"

# Load active environment configurations if they exist
if [ -f "/root/ServerDash/backend/.env" ]; then
  export $(grep -v '^#' /root/ServerDash/backend/.env | xargs)
fi

# Detect public/host IP dynamically
HOST_IP=$(curl -s --max-time 3 ifconfig.me)
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
fi

# 1. Build frontend dist if missing
if [ ! -d "/root/ServerDash/frontend/dist" ] || [ ! -f "/root/ServerDash/frontend/dist/index.html" ]; then
  echo "📦 Production assets missing. Compiling frontend now..."
  cd /root/ServerDash/frontend && npm run build
fi

# 2. Sync to secure www-data accessible path
echo "📂 Synchronizing static assets to secure web directory..."
mkdir -p /var/www/serverdash/dist
cp -r /root/ServerDash/frontend/dist/* /var/www/serverdash/dist/
chown -R www-data:www-data /var/www/serverdash
chmod -R 755 /var/www/serverdash

# 3. Ensure Nginx config is enabled and restart Nginx
echo "🌐 Re-establishing Nginx default routing gateway..."
ln -sf /etc/nginx/sites-available/serverdash /etc/nginx/sites-enabled/serverdash
systemctl restart nginx

# 4. Restart backend under PM2 Process Manager
echo "⚡ Starting background Node server under PM2..."
cd /root/ServerDash/backend
pm2 delete serverdash-backend &>/dev/null
pm2 start server.js --name "serverdash-backend"
pm2 save

# Verify health status
sleep 2
BACKEND_OK=$(curl -s http://localhost:4001/api/health | grep -c '"status":"ok"')
NGINX_OK=$(curl -Is http://localhost/ | head -n 1 | grep -c '200')

echo -e "\n\e[32m"
echo "=========================================================="
echo "    🎉 SERVERDASH PANEL BOOTED SUCCESSFULLY! 🎉"
echo "==========================================================\e[0m"
echo ""
echo -e "✅ Backend API:  $([ $BACKEND_OK -gt 0 ] && echo -e '\e[32mRUNNING\e[0m (Port 4001)' || echo -e '\e[31mFAILED\e[0m - Check pm2 logs serverdash-backend')"
echo -e "✅ Nginx Server: $([ $NGINX_OK -gt 0 ] && echo -e '\e[32mRUNNING\e[0m (Port 80)' || echo -e '\e[31mFAILED\e[0m - Check journalctl -u nginx')"
echo ""
echo -e "🌐 \e[1mPanel Access URL\e[0m:  \e[36mhttp://$HOST_IP\e[0m"
echo -e "📧 \e[1mAdmin Username\e[0m:    \e[36m${ADMIN_EMAIL:-admin@serverdash.io}\e[0m"
echo -e "🔑 \e[1mAdmin Password\e[0m:    \e[33m${ADMIN_PASSWORD:-(Loaded from env)}\e[0m"
echo "=========================================================="
echo ""
