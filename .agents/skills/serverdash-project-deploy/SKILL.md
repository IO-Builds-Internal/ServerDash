---
name: serverdash-project-deploy
description: >-
  Standardized zero-conflict deployment playbook for full-stack and microservice projects
  (Node.js, React/Vite, Docker Compose, MySQL, PostgreSQL, Supabase, Redis, RabbitMQ) on Ubuntu VPS
  managed by ServerDash control panel. Enforces host Nginx reverse proxying, Let's Encrypt SSL,
  isolated loopback ports, and zero-downtime GitHub Actions CI/CD workflows.
---

# ServerDash Zero-Conflict Project Deployment Playbook

Use this skill when deploying any web application, API backend, database stack, or microservice onto an Ubuntu VPS managed by the **ServerDash** control panel. This playbook guarantees zero port conflicts, zero interference with existing websites or the ServerDash panel, automatic visibility inside ServerDash, and seamless automated CI/CD with zero downtime.

---

## 1. Core Architecture & Conflict-Prevention Rules

When deploying any project alongside ServerDash:

1. **Host Nginx is the Unified Public Gateway**:
   - Only host Nginx (`systemctl status nginx`) binds to public ports `80` and `443`.
   - Never expose application backend ports directly to public `0.0.0.0` unless strictly necessary for external clients.
   - ServerDash operates at its own host block (e.g., `serverdash` or `<ip>.nip.io`).
   - Every new project gets an independent virtual host file in `/etc/nginx/sites-available/<domain>`.
   - Creating a file in `/etc/nginx/sites-available/` and symlinking to `/etc/nginx/sites-enabled/` **automatically renders the project inside the ServerDash "Websites" panel**.

2. **Internal Loopback & Docker Isolation**:
   - Applications must listen on dedicated internal loopback ports (`127.0.0.1:<PORT>`) or inside private Docker Compose bridge networks.
   - Check port availability before assigning:
     ```bash
     ss -tuln | grep -E ':(3000|3004|3005|4001|5432|6379|8082)'
     ```
   - Any Docker container running on the system **automatically appears in the ServerDash "Docker Apps" panel** with live metrics, logs, and container restart controls.

3. **Database Segregation**:
   - **Host MySQL**: Create a dedicated database and least-privilege user per project (`<project>_db` and `<project>_user`@`127.0.0.1`).
   - **Dockerized PostgreSQL / MariaDB / Redis**: Bind host ports to unique addresses (e.g., `5433:5432` or keep internal to Docker bridge network without host port publication).
   - **Supabase Stacks**: Run inside isolated directories (`/opt/supabase-projects/<project>`) with remapped public ports.

4. **Fail-Safe Git Synchronization in CI/CD**:
   - Production servers must **never** run simple `git pull origin main` directly, as dirty worktrees or local file modifications cause merge conflicts that crash CI/CD.
   - Always execute:
     ```bash
     git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
     git fetch origin main
     git reset --hard origin/main
     git remote set-url origin "https://github.com/${REPO}.git"
     ```

---

## 2. Deployment Archetype A: Decoupled Full-Stack (Node/Express + React Vite + MySQL)

*Typical example: `hire7Auth` (Backend on 3005, Frontend on 3004 / static dist, Host MySQL on 3306).*

### Step A1: Dedicated MySQL Database Setup
Run on the VPS as root:
```bash
mysql -e "
CREATE DATABASE IF NOT EXISTS <project>_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '<project>_user'@'127.0.0.1' IDENTIFIED BY '<strong_password>';
GRANT ALL PRIVILEGES ON <project>_db.* TO '<project>_user'@'127.0.0.1';
FLUSH PRIVILEGES;
"
```

### Step A2: Backend PM2 Daemon Setup
In `/var/www/<project>/backend` or `/root/<project>/backend`:
```bash
# Configure .env
cat <<EOF > .env
PORT=3005
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=<project>_user
DB_PASSWORD=<strong_password>
DB_NAME=<project>_db
JWT_SECRET=$(openssl rand -hex 32)
EOF

# Install & start under PM2
npm ci --production
pm2 start server.js --name "<project>-backend"
pm2 save
```

### Step A3: Frontend Production Build
```bash
cd /root/<project>/frontend
npm ci
npm run build

# Deploy compiled assets to Nginx web root
mkdir -p /var/www/<project>/dist
rsync -a --delete dist/ /var/www/<project>/dist/
chown -R www-data:www-data /var/www/<project>
chmod -R 755 /var/www/<project>
```

### Step A4: Host Nginx Virtual Host & SSL
Create `/etc/nginx/sites-available/<domain>`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;

    root /var/www/<project>/dist;
    index index.html;

    client_max_body_size 50M;

    # Single Page App routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Gateway routing to PM2 backend
    location /api {
        proxy_pass http://127.0.0.1:3005;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site and provision Let's Encrypt SSL:
```bash
ln -sf /etc/nginx/sites-available/<domain> /etc/nginx/sites-enabled/<domain>
nginx -t && systemctl reload nginx
certbot --nginx -d <domain> --register-unsafely-without-email --agree-tos --non-interactive --redirect
```

---

## 3. Deployment Archetype B: Containerized Blue/Green Microservices (Docker Compose)

*Typical example: `hire7-FMS-backend` (Node API + Postgres + Redis + RabbitMQ + S3/MinIO).*

### Critical Gotchas for Alpine & Prisma in Docker:
1. **OpenSSL Compatibility**: Alpine Linux images (`node:22-alpine`) require `apk add --no-cache openssl` so Prisma generates `linux-musl-openssl-3.0.x` instead of crashing with missing `libssl.so.1.1`.
2. **MinIO Image**: The upstream `minio/minio:latest` image on Docker Hub is deprecated and unpullable. Always use `cgr.dev/chainguard/minio:latest`.
3. **Internal Nginx DNS Refresh**: When using Blue/Green containers (`api_blue` / `api_green`), open-source Nginx caches container IPs. Restart the proxy container (`docker compose restart nginx`) upon switching upstreams so requests never hit stale container IPs with `502 Bad Gateway`.

### Step B1: Docker Compose Blueprint (`docker-compose.yml`)
```yaml
services:
  # Internal traffic switcher
  nginx:
    image: nginx:alpine
    container_name: <project>-nginx
    ports:
      - "127.0.0.1:<INTERNAL_PORT>:8082"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped

  api_blue:
    build: .
    container_name: <project>-api-blue
    expose:
      - "8082"
    environment:
      - PORT=8082
      - DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<db>?schema=public
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  api_green:
    build: .
    container_name: <project>-api-green
    expose:
      - "8082"
    environment:
      - PORT=8082
      - DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<db>?schema=public
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    container_name: <project>-postgres
    environment:
      POSTGRES_USER: <user>
      POSTGRES_PASSWORD: <password>
      POSTGRES_DB: <db>
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: <project>-redis
    restart: unless-stopped

  minio:
    image: cgr.dev/chainguard/minio:latest
    container_name: <project>-minio
    environment:
      MINIO_ROOT_USER: admin
      MINIO_ROOT_PASSWORD: <password>
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  minio_data:
```

### Step B2: Zero-Downtime Deployment Script (`scripts/deploy.sh`)
```bash
#!/usr/bin/env bash
set -e

echo "[deploy]: Starting zero-downtime deployment process..."

# 1. Start core data stores
docker compose up -d postgres redis minio

# 2. Wait for database readiness
until docker compose exec -T postgres pg_isready -U <user> -d <db> > /dev/null 2>&1; do
  sleep 2
done

# 3. Cold-start check
BLUE_RUNNING=$(docker compose ps --filter "status=running" -q api_blue 2>/dev/null || true)
GREEN_RUNNING=$(docker compose ps --filter "status=running" -q api_green 2>/dev/null || true)

if [ -z "$BLUE_RUNNING" ] && [ -z "$GREEN_RUNNING" ]; then
  docker compose up -d --build api_blue
  for i in $(seq 1 30); do
    HEALTH=$(docker compose exec -T api_blue wget -qO- http://localhost:8082/health 2>/dev/null || true)
    if echo "$HEALTH" | grep -q '"status":"UP"'; then break; fi
    sleep 2
  done
  sed "s/server api_green:8082;/server api_blue:8082;/" nginx/nginx.conf > nginx/nginx.conf.tmp && cat nginx/nginx.conf.tmp > nginx/nginx.conf && rm -f nginx/nginx.conf.tmp
  docker compose up -d nginx
  exit 0
fi

# 4. Blue-green target determination
if [ -n "$BLUE_RUNNING" ]; then
  ACTIVE="api_blue"
  TARGET="api_green"
else
  ACTIVE="api_green"
  TARGET="api_blue"
fi

# 5. Build and verify target instance
docker compose up -d --no-deps --build "$TARGET"

SUCCESS=0
for i in $(seq 1 30); do
  HEALTH=$(docker compose exec -T "$TARGET" wget -qO- http://localhost:8082/health 2>/dev/null || true)
  if echo "$HEALTH" | grep -q '"status":"UP"'; then
    SUCCESS=1
    break
  fi
  sleep 2
done

if [ "$SUCCESS" -ne 1 ]; then
  echo "[deploy]: Health check failed for $TARGET. Aborting switch."
  docker compose stop "$TARGET"
  exit 1
fi

# 6. Switch traffic and refresh DNS
sed "s/server $ACTIVE:8082;/server $TARGET:8082;/" nginx/nginx.conf > nginx/nginx.conf.tmp && cat nginx/nginx.conf.tmp > nginx/nginx.conf && rm -f nginx/nginx.conf.tmp
docker compose restart nginx
docker compose stop "$ACTIVE"
echo "[deploy]: Switched traffic to $TARGET successfully."
```

### Step B3: Host Nginx Gateway
Create `/etc/nginx/sites-available/<domain>` pointing to `127.0.0.1:<INTERNAL_PORT>`:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:<INTERNAL_PORT>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 4. Universal GitHub Actions CI/CD Template

Deploy this to `.github/workflows/deploy.yml` in the project repository:

```yaml
name: CI/CD Pipeline - Zero Downtime Deploy

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: read

jobs:
  ci:
    name: Build & Test Validation
    runs-on: ubuntu-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Setup Node.js runtime
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: TypeScript Build & Compile Check
        run: npm run build

      - name: Run Test Suite
        run: npm test

  deploy:
    name: Zero-Downtime Deployment to VPS
    needs: ci
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to VPS via SSH
        uses: appleboy/ssh-action@v1.0.3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USERNAME || 'root' }}
          key: ${{ secrets.VPS_SSH_KEY }}
          port: ${{ secrets.VPS_PORT || 22 }}
          envs: GITHUB_TOKEN
          script: |
            set -e
            APP_DIR="${{ secrets.VPS_APP_DIR }}"
            echo "[CI/CD]: Navigating to application directory: $APP_DIR"
            cd "$APP_DIR"

            echo "[CI/CD]: Fetching and syncing latest changes from main branch..."
            git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${{ github.repository }}.git"
            git fetch origin main
            git reset --hard origin/main
            git remote set-url origin "https://github.com/${{ github.repository }}.git"

            echo "[CI/CD]: Executing deployment script..."
            chmod +x scripts/deploy.sh
            ./scripts/deploy.sh
```

### GitHub Secrets Setup via `gh` CLI:
Run from the project root on the administrator's local machine:
```bash
gh secret set VPS_HOST --body "<vps_ip>" --repo <org>/<repo>
gh secret set VPS_USERNAME --body "root" --repo <org>/<repo>
gh secret set VPS_PORT --body "22" --repo <org>/<repo>
gh secret set VPS_APP_DIR --body "/root/<repo>" --repo <org>/<repo>
gh secret set VPS_SSH_KEY < ~/.ssh/github_actions_vps_deploy --repo <org>/<repo>
```

---

## 5. Deployment Verification Checklist

When deployment is complete, verify the 5 checkpoints:

- [ ] **1. Public HTTPS**: `curl -I https://<domain>/health` returns `200 OK`.
- [ ] **2. SSL Certificate**: Certbot certificate is deployed and active with HTTP -> HTTPS 301 redirection.
- [ ] **3. ServerDash Visibility**:
  - Open `https://<serverdash_domain>` in Safari / Chrome.
  - Check **Websites**: `<domain>` is visible and shows SSL active.
  - Check **Docker**: All project containers show running with real-time CPU/RAM stats.
- [ ] **4. Zero Conflict**: ServerDash, existing sites, and new project do not share any ports or file paths.
- [ ] **5. CI/CD Pipeline**: Commit a test change to `main` and verify that GitHub Actions finishes with green status and zero service disruption.
