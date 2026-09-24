# ServerDash 🚀

![ServerDash Banner](./assets/dashboard_banner.png)

<div align="center">

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-22+_LTS-green.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8.svg)
![Auth](https://img.shields.io/badge/Auth-Apple_Passkey_(WebAuthn)-purple.svg)
![Security](https://img.shields.io/badge/Security-Hardened_Jail-success.svg)

**A high-performance, self-hosted VPS management dashboard. Manage websites, Docker stacks, firewalls, analytics, backups, files, packages, and services from a premium minimalist workspace protected by Apple Passkey authentication.**

</div>

---

## ✨ Features & Capabilities

| Module | Description |
| :--- | :--- |
| **🔑 Apple Passkey Auth** | Passwordless biometric authentication using FIDO2 / WebAuthn. Stores credentials natively in **Apple iCloud Keychain** with **Touch ID / Face ID**. Zero-flash CSS containment and single-admin permanent registration lockout. |
| **🎨 4 Minimalist Themes** | Handcrafted, distraction-free color palettes: **Obsidian** (Pure AMOLED), **Slate** (Deep Indigo Gray), **Zinc** (Industrial Technical), and **Titanium** (Warm Metallic Steel). Persisted in localStorage. |
| **📊 Overview & Telemetry** | Real-time CPU, RAM, NVMe disk, and network throughput telemetry with historical sparklines, process table, and core utilization visualizers. |
| **🌐 Websites & Nginx** | Deploy Node.js (PM2), static HTML/JS, or PHP (WordPress/Laravel) applications with automatic virtual host configuration and automated Let's Encrypt SSL via Certbot. |
| **🛡️ Firewall (UFW)** | Interactive UFW firewall manager. Add, toggle, and delete rules with strict port/IP sanitization and safe port-22 recovery guards. |
| **📂 Filesystem Security Jail** | File manager with multi-root allowed jailing (`/var/www`, `/etc/nginx`, `/var/log`, `/var/backups`, `/tmp`). Features symlink traversal dereferencing and native Node.js filesystem operations. |
| **🐳 Docker Apps & Compose** | Container management dashboard showing real-time CPU/RAM limits, lifecycle operations (start/stop/restart/remove), Docker Compose stacks, and live SSE log streams. |
| **📦 Snapshots & Backups** | High-speed VPS snapshots with `rsync` exclusion, storage gauges, automatic cleanup, and one-click full server restoration (Nginx + www + MySQL). |
| **⚡ Software Runtimes** | Monitor installed system runtimes (Node.js, Docker, Nginx, MariaDB), check upstream updates, and stream live command executions. |
| **📧 SMTP & Postfix Mail** | Inspect virtual mailbox allocations, view Postfix mail queues and logs, create system mail users, and test email deliveries. |
| **🗄️ FTP Management** | Built-in `vsftpd` controller with secure chroot directory binding, user account provisioning, and `/usr/sbin/nologin` shell lockdowns. |
| **📈 Web Analytics Suite** | Real-time Nginx access log parsing with active visitor tracking, referrers, browser breakdown, and **GeoIP2 country flags**. |
| **🐙 GitHub CI/CD** | Automated deployment webhooks with HMAC-SHA256 signature verification and AES-256-GCM encrypted OAuth tokens. |
| **💾 Swap Memory Manager** | Reconfigure system swap files (0–32 GB) on the fly with persistent `/etc/fstab` synchronization. |

---

## 🏗️ Architecture

```
                      BROWSER (Safari / Chrome)
               Touch ID / Face ID / iCloud Keychain
                                │
                                │ HTTPS (Port 443)
                                ▼
                     NGINX REVERSE PROXY
                  Let's Encrypt SSL Gateway
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
Static Frontend SPA                            Express Backend API
/var/www/serverdash/dist                      Node 22 LTS (Port 4001)
React 19 + Vite 8 + CSS Variables              PM2 Daemon / Systemd
                                                        │
                                                        ▼
                                               SQLite Vault (auth.db)
                                              • Admin Passkey Credential
                                              • httpOnly Session Tokens
```

---

## ⚡ Quick Start & Deployment

### 🚀 Automated One-Line Installer (Recommended)

Run the automated installer on a clean Ubuntu (20.04 / 22.04 / 24.04) or Debian (11 / 12) VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/IO-Builds-Internal/ServerDash/main/install.sh | bash
```

The script will automatically:
1. Detect public IP and install core tools (`nginx`, `curl`, `git`, `ufw`, `certbot`).
2. Install **Node.js v22 LTS** and **PM2**.
3. Clone and configure ServerDash.
4. Build the frontend and configure the Nginx reverse-proxy.
5. Launch the backend under PM2 with systemd auto-start.

---

### 🛠️ Manual Installation & Development

#### 1. Clone Repository
```bash
git clone https://github.com/IO-Builds-Internal/ServerDash.git
cd ServerDash
```

#### 2. Backend Setup
```bash
cd backend
npm install

# Create environment configuration
cat <<EOF > .env
PORT=4001
NODE_ENV=production
COOKIE_SECRET=$(openssl rand -hex 32)
ALLOW_PASSKEY_RESET=false
VPS_HOST=your-server-ip
EOF

# Start backend
npm run dev
```

#### 3. Frontend Setup
```bash
cd ../frontend
npm install

# Start development server
npm run dev

# Or build for production
npm run build
```

---

## 🔧 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
| :--- | :---: | :--- |
| `PORT` | ❌ | Backend listening port (default: `4001`). |
| `NODE_ENV` | ✅ | Set to `production` or `development`. |
| `COOKIE_SECRET` | ✅ | Cryptographic secret for signing session cookies (`openssl rand -hex 32`). |
| `VPS_HOST` | ✅ | Server IP or primary domain for CORS and WebAuthn RP ID resolution. |
| `ALLOW_PASSKEY_RESET` | ❌ | Emergency reset flag (`true`/`false`). Default is `false`. |
| `ALLOWED_ORIGIN` | ❌ | Additional comma-separated origins allowed for CORS. |
| `GITHUB_CLIENT_ID` | ❌ | Optional GitHub OAuth client ID for repository browsing. |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
| :--- | :---: | :--- |
| `VITE_API_URL` | ❌ | Backend API base URL. Leave empty (`""`) in production for relative reverse-proxy routing. |

---

## 📁 Project Structure

```
ServerDash/
├── frontend/                   # React 19 + Vite 8
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   │   ├── PasskeyAuthModal.jsx   # Apple Passkey setup & login modal
│   │   │   ├── ThemeSwitcher.jsx      # Minimalist theme selector
│   │   │   └── Sidebar.jsx            # Navigation controls
│   │   ├── contexts/           # React state contexts
│   │   │   ├── AuthContext.jsx        # Passkey cookie session state
│   │   │   ├── ThemeContext.jsx       # 4-theme styling provider
│   │   │   └── BrandingContext.jsx    # Custom panel branding
│   │   ├── pages/              # Panel views
│   │   │   ├── OverviewPage.jsx       # Real-time telemetry dashboard
│   │   │   ├── WebsitesPage.jsx       # Nginx site manager
│   │   │   ├── FilesPage.jsx          # Jailed file manager
│   │   │   ├── DockerPage.jsx         # Docker containers & compose
│   │   │   ├── FirewallShieldPage.jsx # UFW rules controller
│   │   │   ├── SnapshotsPage.jsx      # Full server backups
│   │   │   ├── PackagesPage.jsx       # Software runtimes & APT
│   │   │   ├── SmtpPage.jsx           # Postfix mail manager
│   │   │   ├── FtpPage.jsx            # vsftpd user manager
│   │   │   └── AnalyticsPage.jsx      # Nginx GeoIP visitor metrics
│   │   ├── lib/api.js          # Axios client with credentials
│   │   └── index.css           # CSS variables & theme design tokens
│
├── backend/                    # Node.js 22 + Express 5 API
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth-webauthn.js # Apple Passkey WebAuthn & SQLite store
│   │   │   ├── metrics.js      # System telemetry sensors
│   │   │   ├── sites.js        # Nginx vhosts & Certbot SSL
│   │   │   ├── docker.js       # Dockerode socket integration
│   │   │   ├── files.js        # Jailed filesystem operations
│   │   │   ├── firewall.js     # UFW rule controller
│   │   │   ├── snapshots.js    # Backup & restore engine
│   │   │   ├── packages.js     # APT packages & streaming console
│   │   │   ├── smtp.js         # Postfix & mailbox manager
│   │   │   ├── ftp.js          # vsftpd user controller
│   │   │   ├── analytics.js    # Nginx weblog analyzer
│   │   │   └── github.js       # Encrypted GitHub integration
│   │   ├── authMiddleware.js   # Session cookie validator
│   │   └── logger.js           # Winston structured logger
│   ├── data/                   # SQLite database (auth.db) & settings
│   └── server.js               # Application entry point & CORS
│
├── install.sh                  # Automated production installer
└── start.sh                    # Development start script
```

---

## 🔒 Security Architecture

1. **Apple Passkeys & WebAuthn:**
   - Platform authenticator required (`authenticatorAttachment: "platform"`).
   - Touch ID / Face ID hardware-bound authentication stored in iCloud Keychain.
   - Replay protection with strict `sign_count` tracking.
   - **Single-Admin Lockout:** The first registration permanently locks the endpoint (`403 Forbidden`).
2. **Session Security:**
   - 256-bit cryptographically secure session tokens stored in SQLite (`admin_sessions`).
   - Cookies configured with `httpOnly`, `SameSite=Lax`, and `Secure` (in production).
3. **Filesystem Jail:**
   - Restricted strictly to `/var/www`, `/etc/nginx`, `/var/log`, `/var/backups`, and `/tmp`.
   - Resolves symlinks via `fs.realpathSync()` to block directory traversal into `/etc/shadow`, `/root/.ssh`, or system files.
   - Uses native Node.js filesystem calls (`fs.rmSync`, `fs.cpSync`) instead of shell string interpolation.
4. **CORS Enforcement:**
   - Wildcard DNS support (`*.sslip.io`, `*.nip.io`) and host validation. Unlisted external origins are rejected with errors.
5. **Rate Limiting:**
   - Global rate limiter (120 req/min) and dedicated console execution limiter (10 req/min).

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
