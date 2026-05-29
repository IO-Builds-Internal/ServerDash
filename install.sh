#!/usr/bin/env bash

# ServerDash Automated Installer
# Supported OS: Ubuntu 20.04/22.04/24.04, Debian 11/12

# Check if run as root
if [ "$EUID" -ne 0 ]; then
  echo -e "\e[31m❌ Error: Please run this installer as root (sudo bash install.sh).\e[0m"
  exit 1
fi

echo -e "\e[36m"
echo "=========================================================="
echo "    ⚡ ServerDash Automated VPS Panel Installer ⚡"
echo "=========================================================="
echo -e "\e[0m"

# 1. Detect public IP address
echo -e "🌐 Detecting public VPS IP address..."
IP_ADDRESS=$(curl -4 -s --max-time 5 api.ipify.org)
if [ -z "$IP_ADDRESS" ]; then
  IP_ADDRESS=$(curl -4 -s --max-time 5 ifconfig.me)
fi
if [ -z "$IP_ADDRESS" ]; then
  IP_ADDRESS=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | grep -v '^172\.17\.' | head -n 1)
fi
if [ -z "$IP_ADDRESS" ]; then
  IP_ADDRESS=$(hostname -I | awk '{print $1}')
fi
echo -e "👉 Detected IP: \e[32m$IP_ADDRESS\e[0m"

# 2. Update System Packages
echo -e "\n🔄 Updating system package index..."
apt-get update -y

# 3. Install Core Linux Dependencies
echo -e "\n📦 Installing core dependencies (curl, git, nginx, python, pip, zip)..."
apt-get install -y curl git nginx python3 python3-pip python3-venv zip unzip ufw

# 4. Install Node.js & NPM (LTS 20)
if ! command -v node &> /dev/null; then
  echo -e "\n🟢 Installing Node.js v20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo -e "👉 Node.js already installed: $(node -v)"
fi

# Install PM2 globally
echo -e "\n🟢 Installing PM2 process manager globally..."
npm install -g pm2

# 5. Install Docker & Docker Compose
if ! command -v docker &> /dev/null; then
  echo -e "\n🐳 Installing Docker Engine..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo -e "🐳 Docker already installed: $(docker --version)"
fi

# Ensure docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
  echo -e "🐳 Installing Docker Compose..."
  apt-get install -y docker-compose
fi

# 6. Ensure ServerDash files exist
SD_DIR="/root/ServerDash"
if [ ! -d "$SD_DIR" ]; then
  echo -e "\n📥 Cloning ServerDash codebase from GitHub..."
  git clone https://github.com/iobuilds/ServerDash.git "$SD_DIR"
fi

# 7. Generate Secure Admin Credentials & Config
echo -e "\n🔒 Generating secure credentials and configuration..."
ADMIN_EMAIL="admin@serverdash.io"
ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')
JWT_SECRET=$(openssl rand -hex 32)

# Write Backend Environment Config
cat <<EOF > "$SD_DIR/backend/.env"
PORT=4001
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
LOCAL_JWT_SECRET=$JWT_SECRET
LOCAL_JWT_EXPIRES=8h
VITE_API_URL=http://$IP_ADDRESS
EOF

# Write Frontend Environment Config (for compilation build bindings)
cat <<EOF > "$SD_DIR/frontend/.env"
VITE_API_URL=http://$IP_ADDRESS
EOF

# 8. Install & Build Backend
echo -e "\n⚙️ Installing ServerDash backend dependencies..."
cd "$SD_DIR/backend"
npm install --production

# 9. Install & Build Frontend Static Dist Assets
echo -e "\n⚙️ Installing and building ServerDash frontend assets..."
cd "$SD_DIR/frontend"
npm install
npm run build

# 9.5 Sync compiled assets to Nginx traversable path
echo -e "\n📂 Synchronizing static assets to secure web directory..."
mkdir -p /var/www/serverdash/dist
cp -r "$SD_DIR/frontend/dist"/* /var/www/serverdash/dist/
chown -R www-data:www-data /var/www/serverdash
chmod -R 755 /var/www/serverdash

# 10. Configure Nginx Unified Reverse Proxy
echo -e "\n🌐 Configuring Nginx reverse-proxy gateway..."
NGINX_CONF="/etc/nginx/sites-available/serverdash"

cat <<'EOF' > "$NGINX_CONF"
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/serverdash/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Disable buffering for real-time SSE logs
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
EOF

# Enable ServerDash site and remove default
rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/serverdash

# Restart Nginx
systemctl restart nginx

# 11. Run Backend Server under PM2 Daemon
echo -e "\n⚡ Launching ServerDash Backend Process under PM2..."
cd "$SD_DIR/backend"
pm2 delete serverdash-backend &>/dev/null
pm2 start server.js --name "serverdash-backend"
pm2 save
pm2 startup | tail -n 1 | bash # Set up PM2 system startup persistence

# 12. Adjust Firewall
echo -e "\n🛡️ Adjusting firewall rules (allowing SSH, HTTP, HTTPS and panel ports)..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 4001/tcp
  ufw allow 5173/tcp
  ufw --force enable
fi

# 13. Pre-cache Supabase Repository (One-time download for instant project setup)
echo -e "\n🐳 Pre-caching Supabase Docker Repository..."
mkdir -p /opt/supabase-projects
if [ ! -d "/opt/supabase-repo" ]; then
  git clone --depth 1 https://github.com/supabase/supabase.git /opt/supabase-repo
fi

# 14. Output Beautiful Setup Completion Dashboard
echo -e "\n\e[32m=========================================================="
echo "    🎉 SERVERDASH PANEL INSTALLED SUCCESSFULLY! 🎉"
echo "==========================================================\e[0m"
echo ""
echo -e "🌐 \e[1mPanel Access URL\e[0m:  \e[36mhttp://$IP_ADDRESS\e[0m"
echo -e "📧 \e[1mAdmin Username\e[0m:    \e[36m$ADMIN_EMAIL\e[0m"
echo -e "🔑 \e[1mAdmin Password\e[0m:    \e[33m$ADMIN_PASSWORD\e[0m"
echo ""
echo "----------------------------------------------------------"
echo -e "🛡️ \e[95mSecurity Note\e[0m: Store these credentials safely! You can"
echo "   change them or update branding logos anytime via Settings."
echo "----------------------------------------------------------"
echo -e "⚙️  \e[1mPM2 Utility Commands\e[0m:"
echo "   - View status:  pm2 status"
echo "   - View logs:    pm2 logs serverdash-backend"
echo "   - Restart panel: pm2 restart serverdash-backend"
echo "=========================================================="
echo ""
