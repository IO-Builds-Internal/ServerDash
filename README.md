# ServerDash 🚀

<div align="center">

![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8.svg)

**A self-hosted VPS management dashboard. Manage websites, Docker containers, files, packages, and more — all from a beautiful dark-mode UI.**

</div>

---

## ✨ Features

| Module | Capabilities |
|--------|-------------|
| **Overview** | Real-time CPU/RAM/disk/network metrics, rolling 60s charts, load average |
| **Websites** | Deploy static/Node/PHP sites, nginx config generation, PM2, SSL via certbot |
| **File Manager** | Browse `/var/www`, upload/download/delete, Monaco editor preview |
| **Docker Apps** | Card grid with live CPU/memory stats, deploy, start/stop/restart, live logs |
| **Packages** | Search installed apt packages, install with SSE streaming, custom sudo exec |
| **Supabase** | Self-hosted Supabase instances via docker-compose, pg_dump backup |
| **SMTP & Mail** | SMTP config, test email, email logs, Postfix control |
| **Settings** | VPS SSH config, API URL, alert thresholds |

---

## 🏗️ Architecture

```
                ┌─────────────────────┐
                │   Browser (React)   │
                │   Vite + Tailwind   │
                │  Auth: Supabase     │
                └──────────┬──────────┘
                           │ HTTPS + JWT
                ┌──────────▼──────────┐
                │  Express Backend    │
                │  Node.js + SSH      │
                │  Dockerode + nodemailer│
                └──────┬──────┬───────┘
                       │ SSH  │ Docker socket
              ┌────────▼──┐ ┌─▼──────────────┐
              │  Your VPS │ │ Docker Engine  │
              │  (Ubuntu) │ │ (same host)    │
              └───────────┘ └────────────────┘
```

---

## ⚡ Quick Start & Deployment

### 🚀 The One-Command Automated Installer (Highly Recommended)
If you are setting up ServerDash on a **freshly formatted VPS** (running Ubuntu 20.04/22.04/24.04 or Debian 11/12), you can run our production-ready, fully automated one-line installer. 

This script automatically provisions all OS libraries, configures reverse-proxy Nginx servers, sets up Node/PM2 runtimes, configures firewalls, generates secure credentials, and outputs a beautiful login credentials summary dashboard!

To begin, simply execute the following command:

```bash
curl -fsSL https://raw.githubusercontent.com/iobuilds/ServerDash/main/install.sh | bash
```

---

### 🛠️ Manual Configuration & Development

If you prefer to configure components manually, follow these standard steps:

#### 1. Clone & Configure
```bash
git clone https://github.com/iobuilds/ServerDash.git
cd ServerDash
```

#### 2. Local Runtimes
```bash
# Terminal 1 — Launch Backend Service
cd backend && npm install && npm start

# Terminal 2 — Launch Frontend Interface
cd frontend && npm install && npm run dev
```

---

## 🔧 Environment Variables

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anonymous key |
| `VITE_API_URL` | ✅ | Backend API URL (e.g. `http://your-vps:3001`) |

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Supabase project URL (for JWT verification) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `VPS_HOST` | ✅ | VPS IP address or hostname |
| `VPS_USER` | ✅ | SSH username (e.g. `root`) |
| `VPS_KEY_PATH` | ✅ | Path to SSH private key |
| `VPS_PORT` | ❌ | SSH port (default: `22`) |
| `ALLOWED_ORIGIN` | ✅ | Frontend domain for CORS |
| `PORT` | ❌ | Backend port (default: `3001`) |

---

## 📁 Project Structure

```
ServerDash/
├── frontend/                   # React + Vite + Tailwind v4
│   ├── src/
│   │   ├── pages/              # One file per dashboard section
│   │   │   ├── LoginPage.jsx
│   │   │   ├── OverviewPage.jsx
│   │   │   ├── WebsitesPage.jsx
│   │   │   ├── FilesPage.jsx
│   │   │   ├── DockerPage.jsx
│   │   │   ├── PackagesPage.jsx
│   │   │   ├── SupabasePage.jsx
│   │   │   ├── SmtpPage.jsx
│   │   │   └── SettingsPage.jsx
│   │   ├── components/
│   │   │   ├── Sidebar.jsx     # Collapsible with connection status
│   │   │   └── ProtectedRoute.jsx
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx # Supabase auth state
│   │   ├── lib/
│   │   │   ├── api.js          # Axios with JWT injection
│   │   │   ├── supabase.js
│   │   │   └── utils.js
│   │   └── index.css           # Tailwind v4 + CSS custom properties
│   └── Dockerfile
│
├── backend/                    # Node.js + Express
│   ├── src/
│   │   ├── routes/
│   │   │   ├── metrics.js      # SSH: top/free/df/uptime
│   │   │   ├── sites.js        # nginx + PM2 + certbot
│   │   │   ├── docker.js       # dockerode
│   │   │   ├── packages.js     # apt + SSE streaming
│   │   │   ├── files.js        # SFTP file operations
│   │   │   ├── smtp.js         # nodemailer + Postfix
│   │   │   └── supabase.js     # Self-hosted Supabase
│   │   ├── authMiddleware.js   # Supabase JWT validation
│   │   ├── sshPool.js          # SSH connection pool
│   │   └── logger.js           # Winston
│   ├── server.js               # Express app entry
│   └── Dockerfile
│
├── docker-compose.yml
└── README.md
```

---

## 🔒 Security Notes

- All API routes require a valid Supabase JWT token
- Rate limiting: 120 req/min general, 10 req/min for exec
- SSH commands are logged with Winston
- File manager restricts access to safe paths (`/var/www`, `/opt`, etc.)
- The `exec` endpoint blocks dangerous patterns (`rm -rf /`, `mkfs`, etc.)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push and open a Pull Request

Please follow the existing code style and add JSDoc comments to new functions.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
