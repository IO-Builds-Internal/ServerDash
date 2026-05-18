# ServerDash - Project Status

> Generated: 2026-05-17 18:42 Europe/Berlin | Version: 1.0.0

---

## Project Overview

ServerDash is a self-hosted VPS management dashboard with a React/Vite frontend and a Node.js/Express backend. The current implementation runs directly on the VPS and uses local command execution for host management, Docker socket access for container operations, and JWT-protected API routes for the dashboard.

Core modules are present for server metrics, websites/nginx, file management, Docker, packages, SMTP/Postfix, Supabase project management, ports, and settings.

---

## Current Runtime Status

Checked on 2026-05-17 at about 18:20 Europe/Berlin.

| Service | Port | Status | Notes |
|---------|------|--------|-------|
| Frontend (Vite dev server) | `5173` | Running | Bound to `0.0.0.0:5173`; `curl http://localhost:5173/` returns the Vite HTML shell. |
| Backend (Express) | `4001` | Running | `curl http://localhost:4001/api/health` returns `{"status":"ok","version":"1.0.0"}`. Process: `node server.js`. |
| Port `3001` | `3001` | Occupied by another app | Used by `/var/www/pdf-canvas-pro` Cloudflare `workerd`; ServerDash should continue using `4001` locally. |
| Main Supabase stack | `8000 / 8443 / 3000 / 55432 / 65432` | Running | Docker containers are up and mostly healthy. |
| Created Supabase projects | `8100-8103`, `3002-3003`, `55433-55434`, `55533-55534`, `14001-14002` | Running | `testptojectone` and `test4` stacks are up for about 5 hours. |
| Nginx | `80 / 443` | Running | System nginx is listening on both IPv4 and IPv6. |
| SSH | `22` | Running | System sshd is listening on both IPv4 and IPv6. |

---

## Access

| Item | Value |
|------|-------|
| Dashboard URL | `http://213.199.34.74:5173` |
| Login | `admin@serverdash.local` / configured admin password |
| Backend URL | `http://localhost:4001` internally, or configured public API URL from `frontend/.env` |
| Main Supabase URL | `https://db.3dprint.iobuilds.com` |
| VPS IP | `213.199.34.74` |

---

## Project Structure

```text
ServerDash/
├── frontend/                    React 19 + Vite 8 app
│   ├── src/
│   │   ├── pages/               Dashboard pages and Supabase project detail view
│   │   ├── components/          Sidebar + ProtectedRoute
│   │   ├── contexts/            Local auth context
│   │   └── lib/                 API client, local auth client, Supabase helper, utilities
│   ├── dist/                    Existing production build output
│   └── public/                  favicon + icons
├── backend/                     Node.js + Express 5 API
│   ├── server.js                Entry: env load, CORS, rate limits, auth routes, route mounting
│   └── src/
│       ├── routes/              Docker, files, metrics, packages, ports, sites, SMTP, Supabase
│       ├── authMiddleware.js    Local JWT verification
│       ├── sshPool.js           LocalExecutor wrapper around child_process
│       └── logger.js            Winston logger to backend/logs/
├── docker-compose.yml           Stale Docker deployment option; still points backend to 3001
├── start.sh                     Current direct-start helper for port 4001 + 5173
├── README.md                    Partially stale; still describes SSH/Supabase auth/Tailwind v4
└── PROJECT_STATUS.md            This file
```

---

## Module Status

### Login / Auth

- Backend exposes local auth routes: `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`.
- Protected API routes use `authMiddleware.js`, which verifies HS256 JWTs signed with `LOCAL_JWT_SECRET`.
- Frontend uses `frontend/src/lib/auth.js` and stores the token in `localStorage` under `serverdash_token`.
- Supabase auth is no longer used for dashboard login, although Supabase packages/env variables still exist for Supabase-related features.

Status: implemented and currently active.

### Overview / Metrics

- Backend: `GET /api/metrics`.
- Backend history: `GET /api/metrics/history?range=5m|15m|1h|6h|24h`.
- Uses local execution for `top`, `free`, `df`, `/proc/net/dev`, `uptime`, and `/proc/uptime`.
- Frontend shows CPU, RAM, disk, network, uptime, and load average with saved-history charts.
- Current logs show metrics polling every 5 seconds.
- Metric history is persisted to `backend/data/metrics-history.json` with 24-hour retention and a backend sampler, so history keeps collecting even when the overview page is closed.

Status: implemented and running.

### Websites / Nginx

- Backend route file: `backend/src/routes/sites.js`.
- Supports repo checks, Node version detection, port suggestions, listing nginx/website entries, nginx config read/write, basic site create, deploy/restart, delete, logs, and create wizard with optional ZIP upload.
- Frontend page: `frontend/src/pages/WebsitesPage.jsx`.
- New-site wizard now renders through a body-level overlay so the popup is centered in the viewport.
- Source selection is optional; users can create/configure a site first and attach Git/ZIP/files later.
- Node app creation now accepts Vercel-style install/build/start commands, package manager hints, `.env` content, Node version selection, and PM2 startup. Install/build/start are checkbox-controlled so users can defer them.
- PHP creation now supports PHP-FPM version selection, Laravel-ready config, CDN/cache headers, and a best-effort one-click WordPress bootstrap with generated `wp-config.php`.
- PHP/WordPress wizard can optionally capture mailbox requests and prepares Maildir folders when local mail services are present.

Status: implemented.

### File Manager

- Backend route file: `backend/src/routes/files.js`.
- Supports list, read, write, mkdir, rename, delete, upload, and download.
- Frontend page: `frontend/src/pages/FilesPage.jsx`.

Status: implemented. Security posture remains broad because it can browse much of the filesystem with only a small hard blocklist.

### Docker

- Backend route file: `backend/src/routes/docker.js`.
- Uses dockerode and `/var/run/docker.sock`.
- Supports container list with stats, image deployment, compose deployment, start/stop/restart/remove, SSE logs, Docker Hub search, images, and networks.
- Frontend page: `frontend/src/pages/DockerPage.jsx`.

Status: implemented.

### Packages / Command Streaming

- Backend route file: `backend/src/routes/packages.js`.
- Supports installed package list, apt search/info, install/remove streams, apt update stream, `.deb` install/archive extraction, and guarded arbitrary command streaming.
- Mounted both under `/api/packages` and `/api/exec` with a stricter rate limiter for `/api/exec`.
- Frontend page: `frontend/src/pages/PackagesPage.jsx`.

Status: implemented. The command streaming surface is powerful and should be treated as admin-only.

### SMTP / Postfix

- Backend route file: `backend/src/routes/smtp.js`.
- Supports SMTP config, auto-detection from `supabase-auth`, test email, in-memory mail logs, Postfix status/actions, and Postfix install stream.
- Frontend page: `frontend/src/pages/SmtpPage.jsx`.

Status: implemented. SMTP config and logs are in memory and are lost on backend restart.

### Supabase Management

- Backend route file: `backend/src/routes/supabase.js`.
- Supports project list, create stream with SQL backup upload, key retrieval, backup, migration upload/run, delete, register, detail, logs, down, env update/reveal, migrations listing, and lifecycle actions.
- Frontend pages: `frontend/src/pages/SupabasePage.jsx` and `frontend/src/pages/ProjectDetailPage.jsx`.
- Runtime has the main Supabase stack plus created project stacks under `/opt/supabase-projects`.
- Project cards now show anon-key copy controls and a proxy-config helper for nginx API/Studio reverse proxy setup.
- Copy buttons include an HTTP-safe fallback for the dashboard's current non-HTTPS deployment.

Status: implemented and actively used.

### Settings

- Backend settings store is in memory only.
- Frontend page: `frontend/src/pages/SettingsPage.jsx`.

Status: implemented but not persisted.

### Ports API

- Backend route file: `backend/src/routes/ports.js`.
- Supports listening port list, available-port search, and single-port checks.
- Used internally by deployment flows; no standalone frontend page.

Status: implemented.

---

## Security And Auth

| Layer | Current Implementation |
|-------|------------------------|
| Dashboard login | Local email/password from env or defaults. |
| API auth | Local JWT via `LOCAL_JWT_SECRET`; all protected routes mount after `/api/auth/*`. |
| Rate limiting | 120 req/min for `/api/*`; 10 req/min for `/api/exec`. |
| CORS | Configurable via `ALLOWED_ORIGIN`, but current code allows unmatched origins in development-style fallback. |
| File paths | Only a small set of dangerous paths is hard-blocked. |
| Command execution | LocalExecutor runs commands on the VPS; package exec has a basic danger-pattern blocklist. |
| Logging | Winston logs to `backend/logs/combined.log` and `backend/logs/error.log`; start script also writes `/tmp/serverdash-backend.log` and `/tmp/serverdash-frontend.log`. |

---

## Environment Configuration

### Backend `.env`

Configured variable names currently present:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
ALLOWED_ORIGIN
JWT_JWKS
JWT_SECRET
LOCAL_JWT_EXPIRES
LOCAL_JWT_SECRET
NODE_ENV
PORT
POSTGRES_DB
POSTGRES_HOST
POSTGRES_PASSWORD
POSTGRES_PORT
POSTGRES_USER
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
```

Important runtime values:

- `PORT=4001`
- `NODE_ENV=production`
- `LOCAL_JWT_SECRET` is present, so local dashboard auth can issue and verify JWTs.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are still configured for Supabase-related functionality.

### Frontend `.env`

Configured variable names currently present:

```text
VITE_API_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_URL
```

Important runtime value:

- `VITE_API_URL` should point at the backend on port `4001` for the direct VPS deployment.

---

## Dependencies

### Backend

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | `^5.2.1` | HTTP server |
| `dotenv` | `^17.4.2` | Env loading |
| `jsonwebtoken` | `^9.0.3` | Local JWT auth |
| `@supabase/supabase-js` | `^2.105.4` | Supabase integration/dependency still present |
| `dockerode` | `^5.0.0` | Docker Engine API |
| `nodemailer` | `^8.0.7` | SMTP test emails |
| `node-ssh` | `^13.2.1` | Dependency still present; current executor is local |
| `multer` | `^2.1.1` | File uploads |
| `winston` | `^3.19.0` | Logging |
| `express-rate-limit` | `^8.5.1` | Rate limiting |
| `uuid` | `^14.0.0` | Supabase project IDs |
| `axios` | `^1.16.1` | External HTTP calls |

### Frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `react` / `react-dom` | `^19.2.6` | UI framework |
| `vite` | `^8.0.12` | Dev/build tooling |
| `react-router-dom` | `^7.15.0` | Routing |
| `recharts` | `^3.8.1` | Charts |
| `lucide-react` | `^1.14.0` | Icons |
| `@monaco-editor/react` | `^4.7.0` | Editor dependency |
| `@radix-ui/*` | multiple | UI primitives |
| `tailwindcss` / `@tailwindcss/vite` | `^4.3.0` | Dependency present |
| `axios` | `^1.16.1` | API client |

---

## Known Issues And Open Items

### Critical

| # | Issue | Detail |
|---|-------|--------|
| 1 | Local auth timing-safe comparison can throw on different-length input | `crypto.timingSafeEqual` requires buffers of equal length. Login attempts with an email/password length different from the configured values may throw and hit the global 500 handler instead of returning 401. |

### Moderate

| # | Issue | Detail |
|---|-------|--------|
| 2 | Settings are not persisted | `settings` is an in-memory object in `server.js`; values are lost on restart. |
| 3 | SMTP config/logs are not persisted | `smtp.js` keeps config and last logs in memory only. |
| 4 | Docker compose deployment file is stale | `docker-compose.yml` still maps backend to `3001` and uses Supabase/SSH env assumptions, while the active direct deployment uses local JWT auth and backend port `4001`. |
| 5 | Env examples are stale | `.env.example` files still describe Supabase auth/SSH details and `3001`; they do not document `LOCAL_JWT_SECRET`, `ADMIN_EMAIL`, or `ADMIN_PASSWORD`. |
| 6 | README is stale | README still says React 18, SSH-based backend access, Supabase auth, and Tailwind-first styling. Current code uses React 19, local execution, and local JWT dashboard auth. |
| 7 | CORS is effectively permissive | The configured origin is collected, but the fallback currently calls `cb(null, true)` for unmatched origins too. |

### Minor / Enhancement Ideas

| # | Item |
|---|------|
| 8 | Add persistent JSON or DB-backed settings storage. |
| 9 | Add persistent SMTP config storage with secret handling. |
| 10 | Add a standalone ports page or richer port conflict UI. |
| 11 | Add a PM2/process manager page for Node sites. |
| 12 | Add container config editing or redeploy support on the Docker page. |
| 13 | Add project-level health details for Supabase services in the UI. |
| 14 | Add longer metrics retention or aggregation if more than 24 hours of history is needed. |
| 15 | Mailbox creation is best-effort only | The website wizard records requested mailboxes and creates Maildir folders where possible, but full Postfix/Dovecot virtual mailbox wiring still needs a dedicated mail settings flow. |
| 16 | Add production serving guidance for frontend `dist/` instead of relying only on Vite dev server. |

---

## How To Start

```bash
# Current direct VPS start helper
bash /root/ServerDash/start.sh

# Health checks
curl http://localhost:4001/api/health
curl http://localhost:5173/

# Port checks
ss -tlnp | grep -E ':(4001|5173)\b'
```

Logs:

```bash
tail -f /tmp/serverdash-backend.log
tail -f /tmp/serverdash-frontend.log
tail -f /root/ServerDash/backend/logs/combined.log
```

---

## Completion Summary

| Module | Backend API | Frontend UI | Notes |
|--------|-------------|-------------|-------|
| Login / Auth | Complete | Complete | Local JWT auth; Supabase auth wording in docs is stale. |
| Overview / Metrics | Complete | Complete | Running, polling, and saving 24h metric history. |
| Websites / Nginx | Complete | Complete | Wizard/editor/deploy flows present. |
| File Manager | Complete | Complete | Broad filesystem access. |
| Docker | Complete | Complete | Docker socket based. |
| Packages / Exec | Complete | Complete | Powerful admin command surface. |
| SMTP / Postfix | Complete | Complete | Config/log persistence missing. |
| Supabase | Complete | Complete | Includes detail, env, migration, backup, and lifecycle routes. |
| Ports API | Complete | Internal only | No standalone page. |
| Settings | In-memory | Complete | Persistence missing. |

Overall status: about 91-93% complete. The app is running today on ports `5173` and `4001`; the most important remaining work is documentation cleanup, persistence for settings/SMTP, safer auth failure handling, and tightening production deployment/security defaults.

---

## Verification Performed For This Update

- Reviewed `README.md`, `PROJECT_STATUS.md`, `start.sh`, `docker-compose.yml`, package manifests, auth files, app routing, and backend route registration.
- Checked listening ports with `ss -tlnp`.
- Checked backend health with `curl http://localhost:4001/api/health`.
- Checked frontend Vite response with `curl http://localhost:5173/`.
- Checked Docker container status with `docker ps`.
- Reviewed recent backend logs in `backend/logs/combined.log`.
