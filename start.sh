#!/bin/bash
# ServerDash start script — run this to start/restart all services

echo "🚀 Starting ServerDash..."

# Kill any existing instances
pkill -9 -f "vite" 2>/dev/null
pkill -f "node server.js" 2>/dev/null
sleep 2

# Start backend
echo "Starting backend on port 4001..."
cd /root/ServerDash/backend
setsid -f node server.js > /tmp/serverdash-backend.log 2>&1
sleep 1
echo "Backend PID: $(pgrep -f 'node server.js' | tail -1)"

sleep 3

# Start frontend
echo "Starting frontend on port 5173..."
cd /root/ServerDash/frontend
setsid -f npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/serverdash-frontend.log 2>&1
sleep 1
echo "Frontend PID: $(pgrep -f 'vite --host 0.0.0.0 --port 5173' | tail -1)"

sleep 8

# Load active environment configurations if they exist
if [ -f "/root/ServerDash/backend/.env" ]; then
  export $(grep -v '^#' /root/ServerDash/backend/.env | xargs)
fi

# Detect public/host IP dynamically
HOST_IP=$(curl -s --max-time 3 ifconfig.me)
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
fi

# Verify
BACKEND_OK=$(curl -s http://localhost:4001/api/health | grep -c '"ok"')
FRONTEND_OK=$(ss -tlnp | grep -c "5173")

echo ""
echo "✅ Backend:  $([ $BACKEND_OK -gt 0 ] && echo 'OK → http://localhost:4001' || echo 'FAILED — check /tmp/serverdash-backend.log')"
echo "✅ Frontend: $([ $FRONTEND_OK -gt 0 ] && echo "OK → http://${HOST_IP}:5173" || echo 'FAILED — check /tmp/serverdash-frontend.log')"
echo ""
echo "Login: ${ADMIN_EMAIL:-admin@serverdash.local} / ${ADMIN_PASSWORD:-ServerDash2026!}"
