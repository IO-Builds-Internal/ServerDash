const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');
const yaml = require('yaml');

const PROJECTS_DIR = '/opt/supabase-projects';
const REPO_PATH = '/opt/supabase-repo';
const PROJECTS_FILE = `${PROJECTS_DIR}/.projects.json`;

// Arguments: domain, sitePath, siteId
const [,, domain, sitePath, siteId] = process.argv;

if (!domain || !sitePath || !siteId) {
  console.error('Usage: node setup-freepos.js <domain> <sitePath> <siteId>');
  process.exit(1);
}

const projectId = `freepos-${siteId}`;
const projectPath = path.join(PROJECTS_DIR, projectId);

console.log(`[BOOTSTRAP] Starting FreePOS.lk setup for ${domain} (${projectId})...`);

try {
  // ── Step 1: Clean and Clone Codebase ───────────────────────────────────────
  console.log('[BOOTSTRAP] Cleaning and cloning codebase...');
  if (fs.existsSync(sitePath)) {
    // Delete files except .serverdash.json
    execSync(`find ${sitePath} -mindepth 1 -not -name ".serverdash.json" -delete 2>/dev/null || true`);
  } else {
    fs.mkdirSync(sitePath, { recursive: true });
  }

  execSync(`git clone https://github.com/dhanushka047/storeharmony-saas.git .`, { cwd: sitePath, stdio: 'inherit' });
  console.log('✓ Codebase cloned successfully');

  // Copy local rebranded/customized components from pos.iobuilds.com if present
  console.log('[BOOTSTRAP] Injecting local branding overrides and Logo...');
  const refPath = '/var/www/pos.iobuilds.com';
  if (fs.existsSync(refPath)) {
    try {
      fs.copyFileSync(path.join(refPath, 'src/pages/Landing.tsx'), path.join(sitePath, 'src/pages/Landing.tsx'));
      if (!fs.existsSync(path.join(sitePath, 'src/components'))) {
        fs.mkdirSync(path.join(sitePath, 'src/components'), { recursive: true });
      }
      fs.copyFileSync(path.join(refPath, 'src/components/Logo.tsx'), path.join(sitePath, 'src/components/Logo.tsx'));
      fs.copyFileSync(path.join(refPath, 'src/pages/Login.tsx'), path.join(sitePath, 'src/pages/Login.tsx'));
      fs.copyFileSync(path.join(refPath, 'src/pages/Signup.tsx'), path.join(sitePath, 'src/pages/Signup.tsx'));
      fs.copyFileSync(path.join(refPath, 'src/components/AppSidebar.tsx'), path.join(sitePath, 'src/components/AppSidebar.tsx'));
      console.log('✓ Local files successfully copied');
    } catch (e) {
      console.warn('⚠ Warning: Failed to copy local overrides:', e.message);
    }
  }

  // ── Step 2: Determine Available Ports ─────────────────────────────────────
  console.log('[BOOTSTRAP] Allocating unique ports for Supabase stack...');
  let registry = [];
  if (fs.existsSync(PROJECTS_FILE)) {
    try {
      registry = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    } catch (e) {
      console.warn('Warning: Could not parse .projects.json, defaulting to empty registry.');
    }
  }

  // Get max ports in use
  let maxKong = 8400;
  let maxKongHttps = 8402;
  let maxStudio = 8401;
  let maxDb = 54342;
  let maxPooler = 54343;
  let maxAnalytics = 14401;

  for (const proj of registry) {
    if (proj.kongPort && proj.kongPort >= maxKong) maxKong = proj.kongPort;
    if (proj.kongHttpsPort && proj.kongHttpsPort >= maxKongHttps) maxKongHttps = proj.kongHttpsPort;
    if (proj.studioPort && proj.studioPort >= maxStudio) maxStudio = proj.studioPort;
    if (proj.dbPort && proj.dbPort >= maxDb) maxDb = proj.dbPort;
    if (proj.poolerPort && proj.poolerPort >= maxPooler) maxPooler = proj.poolerPort;
    if (proj.analyticsPort && proj.analyticsPort >= maxAnalytics) maxAnalytics = proj.analyticsPort;
  }

  const kongPort = maxKong + 10;
  const kongHttpsPort = maxKongHttps + 10;
  const studioPort = maxStudio + 10;
  const dbPort = maxDb + 10;
  const poolerPort = maxPooler + 10;
  const analyticsPort = maxAnalytics + 10;

  console.log(`Allocated ports: Kong=${kongPort}, DB=${dbPort}, Studio=${studioPort}, Pooler=${poolerPort}, Analytics=${analyticsPort}`);

  // ── Step 3: Copy Supabase Template ────────────────────────────────────────
  console.log('[BOOTSTRAP] Preparing Supabase configuration template...');
  if (!fs.existsSync(projectPath)) {
    execSync(`cp -r ${REPO_PATH}/docker ${projectPath}`);
  }

  // ── Step 4: Generate Keys and Modify .env ──────────────────────────────────
  console.log('[BOOTSTRAP] Generating secrets and environment config...');
  const dbPassword = 'FreePOSSecret' + Math.random().toString(36).slice(2, 10) + '!';
  const jwtSecret = require('crypto').randomBytes(32).toString('hex');
  const secretKeyBase = require('crypto').randomBytes(32).toString('hex');

  function generateJWT(role, secret) {
    const payload = {
      role: role,
      iss: "supabase",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60)
    };
    return jwt.sign(payload, secret);
  }

  const anonKey = generateJWT('anon', jwtSecret);
  const serviceKey = generateJWT('service_role', jwtSecret);

  // Read .env.example or template .env
  const envExamplePath = path.join(projectPath, '.env.example');
  let envContent = '';
  if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8');
  } else if (fs.existsSync(path.join(projectPath, '.env'))) {
    envContent = fs.readFileSync(path.join(projectPath, '.env'), 'utf8');
  }

  // Replace variables
  envContent = envContent
    .replace(/^POSTGRES_PASSWORD=.*/m, `POSTGRES_PASSWORD=${dbPassword}`)
    .replace(/^JWT_SECRET=.*/m, `JWT_SECRET=${jwtSecret}`)
    .replace(/^ANON_KEY=.*/m, `ANON_KEY=${anonKey}`)
    .replace(/^SERVICE_ROLE_KEY=.*/m, `SERVICE_ROLE_KEY=${serviceKey}`)
    .replace(/^DASHBOARD_PASSWORD=.*/m, `DASHBOARD_PASSWORD=${dbPassword}`)
    .replace(/^SECRET_KEY_BASE=.*/m, `SECRET_KEY_BASE=${secretKeyBase}`)
    .replace(/^SUPABASE_PUBLIC_URL=.*/m, `SUPABASE_PUBLIC_URL=https://${domain}/supabase-kong`)
    .replace(/^API_EXTERNAL_URL=.*/m, `API_EXTERNAL_URL=https://${domain}/supabase-kong`)
    .replace(/^POSTGRES_PORT=.*/m, `POSTGRES_PORT=${dbPort}`)
    .replace(/^POOLER_PROXY_PORT_TRANSACTION=.*/m, `POOLER_PROXY_PORT_TRANSACTION=${poolerPort}`)
    .replace(/^KONG_HTTP_PORT=.*/m, `KONG_HTTP_PORT=${kongPort}`)
    .replace(/^KONG_HTTPS_PORT=.*/m, `KONG_HTTPS_PORT=${kongHttpsPort}`)
    .replace(/^STUDIO_PORT=.*/m, `STUDIO_PORT=${studioPort}`)
    .replace(/^ANALYTICS_PORT=.*/m, `ANALYTICS_PORT=${analyticsPort}`)
    .replace(/^COMPOSE_PROJECT_NAME=.*/m, `COMPOSE_PROJECT_NAME=${projectId}`)
    .replace(/^SITE_URL=.*/m, `SITE_URL=https://${domain}`)
    // Postfix SMTP settings
    .replace(/^SMTP_ADMIN_EMAIL=.*/m, `SMTP_ADMIN_EMAIL=noreply@${domain}`)
    .replace(/^SMTP_HOST=.*/m, `SMTP_HOST=host.docker.internal`)
    .replace(/^SMTP_PORT=.*/m, `SMTP_PORT=25`)
    .replace(/^SMTP_USER=.*/m, `SMTP_USER=`)
    .replace(/^SMTP_PASS=.*/m, `SMTP_PASS=`)
    .replace(/^SMTP_SENDER_NAME=.*/m, `SMTP_SENDER_NAME=FreePOS.lk`);

  fs.writeFileSync(path.join(projectPath, '.env'), envContent);
  console.log('✓ Environment keys written');

  // ── Step 5: Modify docker-compose.yml ─────────────────────────────────────
  console.log('[BOOTSTRAP] Customizing docker-compose.yml memory limits & host routing...');
  const composePath = path.join(projectPath, 'docker-compose.yml');
  let composeTxt = fs.readFileSync(composePath, 'utf8');
  const doc = yaml.parseDocument(composeTxt);
  
  const services = doc.get('services');

  // Set memory limits & pass -p for DB bind, and extra_hosts for Auth
  for (const item of services.items) {
    const serviceName = item.key.value;
    const service = item.value;

    let limit = '256M';
    if (['db', 'analytics', 'studio', 'kong', 'logflare'].includes(serviceName)) {
      limit = '1024M';
    } else if (serviceName === 'vector') {
      limit = '128M';
    }
    service.setIn(['deploy', 'resources', 'limits', 'memory'], limit);

    if (serviceName === 'db') {
      // Force postgres to bind internal TCP port using -p command line argument
      service.set('command', [
        "postgres",
        "-p",
        "${POSTGRES_PORT}",
        "-c",
        "config_file=/etc/postgresql/postgresql.conf",
        "-c",
        "log_min_messages=fatal"
      ]);
    }

    if (serviceName === 'auth') {
      // Add extra_hosts to allow auth container to connect to host's Postfix server
      service.set('extra_hosts', ["host.docker.internal:host-gateway"]);
    }
  }

  fs.writeFileSync(composePath, doc.toString());
  console.log('✓ docker-compose.yml updated');

  // ── Step 6: Start Supabase Stack ──────────────────────────────────────────
  console.log('[BOOTSTRAP] Spanning Supabase Docker stack...');
  execSync(`docker compose down 2>/dev/null || true`, { cwd: projectPath });
  execSync(`docker compose up -d`, { cwd: projectPath, stdio: 'inherit' });
  console.log('✓ Supabase Docker stack started');

  // ── Step 7: Apply SQL Migrations ──────────────────────────────────────────
  console.log('[BOOTSTRAP] Executing database migrations...');
  const migrationsDir = path.join(sitePath, 'supabase/migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      console.log(`  --> Executing migration: ${file}`);
      execSync(`cat "${filePath}" | docker exec -i ${projectId}-db psql -U postgres postgres`, { stdio: 'ignore' });
    }
    console.log('✓ Database migrations applied');
  } else {
    console.warn('⚠ Warning: Migrations directory not found!');
  }

  // ── Step 8: Create Root Admin User ────────────────────────────────────────
  console.log('[BOOTSTRAP] Initializing Root Admin Account...');
  const adminEmail = `admin@${domain}`;
  const adminPassword = 'AdminPos' + Math.random().toString(36).slice(2, 8) + '!';
  
  // Connect to DB directly using psql to fetch or insert users
  // We can write a JS script or run a short node command to create it via supabase-js
  const tempScriptPath = path.join(projectPath, 'temp_admin_seed.js');
  fs.writeFileSync(tempScriptPath, `
const { createClient } = require('${sitePath}/node_modules/@supabase/supabase-js');
const supabase = createClient('http://127.0.0.1:${kongPort}', '${serviceKey}', { auth: { persistSession: false } });
async function run() {
  try {
    const { data: { user }, error: authError } = await supabase.auth.admin.createUser({
      email: '${adminEmail}',
      password: '${adminPassword}',
      email_confirm: true,
      user_metadata: { role: 'super_admin', full_name: 'Root Admin' }
    });
    if (authError) throw authError;
    console.log('SUCCESS:' + user.id);
  } catch(e) {
    console.error(e.message);
    process.exit(1);
  }
}
run();
  `);

  try {
    const result = execSync(`node ${tempScriptPath}`).toString().trim();
    if (result.startsWith('SUCCESS:')) {
      console.log(`✓ Root admin created: ${adminEmail} (password: ${adminPassword})`);
    } else {
      throw new Error(result);
    }
  } catch (e) {
    console.error('⚠ Failed to seed root admin:', e.message);
  } finally {
    fs.unlinkSync(tempScriptPath);
  }

  // ── Step 9: Rebrand Site to FreePOS.lk ─────────────────────────────────────
  console.log('[BOOTSTRAP] Executing branding replacement for FreePOS.lk...');
  const excludeDirs = ['node_modules', '.git', 'dist'];
  function walkDir(dir) {
    fs.readdirSync(dir).forEach(item => {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (!excludeDirs.includes(item)) walkDir(full);
      } else {
        const ext = path.extname(item);
        if (['.ts', '.tsx', '.json', '.html', '.css', '.js'].includes(ext)) {
          let text = fs.readFileSync(full, 'utf8');
          const original = text;
          text = text.replace(/CloudPOS/g, 'FreePOS.lk');
          text = text.replace(/cloudpos\.com/g, 'freepos.lk');
          text = text.replace(/cloudpos_/g, 'freepos_');
          text = text.replace(/cloudpos-/g, 'freepos-');
          text = text.replace(/Cloud\s+POS/gi, 'FreePOS.lk');
          if (text !== original) {
            fs.writeFileSync(full, text, 'utf8');
          }
        }
      }
    });
  }
  walkDir(sitePath);
  console.log('✓ Branding labels modified');

  // ── Step 10: Write .env, keys, and Build React App ────────────────────────
  console.log('[BOOTSTRAP] Writing client keys and environment files...');
  
  const keysContent = {
    SUPABASE_URL: `https://${domain}/supabase-kong`,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    DATABASE_URL: `postgresql://postgres:${dbPassword}@127.0.0.1:${dbPort}/postgres`,
    DB_PASSWORD: dbPassword,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword
  };

  fs.writeFileSync(path.join(sitePath, 'supabase_keys.json'), JSON.stringify(keysContent, null, 2));

  const clientEnv = `NODE_ENV=production
PORT=3000
VITE_SUPABASE_URL=https://${domain}/supabase-kong
VITE_SUPABASE_PUBLISHABLE_KEY=${anonKey}
`;
  fs.writeFileSync(path.join(sitePath, '.env'), clientEnv);

  console.log('[BOOTSTRAP] Installing packages and building production assets...');
  execSync(`npm install`, { cwd: sitePath, stdio: 'inherit' });
  execSync(`npm run build`, { cwd: sitePath, stdio: 'inherit' });
  console.log('✓ Frontend compiled');

  // ── Step 11: Configure Nginx ──────────────────────────────────────────────
  console.log('[BOOTSTRAP] Configuring Nginx reverse proxy routing...');
  const nginxConfig = `server {
    server_name ${domain};
    client_max_body_size 512M;
    root ${sitePath}/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy to Supabase local Kong gateway
    location /supabase-kong/ {
        proxy_pass http://127.0.0.1:${kongPort}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSockets support for Realtime database updates
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Increase timeouts for long-lived WebSocket connections
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
`;

  const nginxFile = `/etc/nginx/sites-available/${domain}`;
  fs.writeFileSync(nginxFile, nginxConfig);
  // Ensure symlink exists
  const enabledLink = `/etc/nginx/sites-enabled/${domain}`;
  if (!fs.existsSync(enabledLink)) {
    fs.symlinkSync(nginxFile, enabledLink);
  }
  execSync(`nginx -t && systemctl reload nginx`);
  console.log('✓ Nginx configuration reloaded');

  // ── Step 12: Write .serverdash.json and Save Project in Registry ──────────
  const sdConfig = {
    installCommand: "npm install",
    buildCommand: "npm run build",
    restartCommand: "echo 'Static deploy complete, reloading Nginx' && systemctl reload nginx",
    nodeVersion: "system"
  };
  fs.writeFileSync(path.join(sitePath, '.serverdash.json'), JSON.stringify(sdConfig, null, 2));

  // Update registry
  const newProject = {
    id: require('uuid').v4(),
    name: projectId,
    apiUrl: `https://${domain}/supabase-kong`,
    studioUrl: `http://${require('os').hostname()}:${studioPort}`,
    dbConn: `postgresql://postgres:${dbPassword}@127.0.0.1:${dbPort}/postgres`,
    kongPort,
    kongHttpsPort,
    studioPort,
    dbPort,
    poolerPort,
    analyticsPort,
    anonKey,
    serviceKey,
    dashboardUser: 'supabase',
    dashboardPass: dbPassword,
    status: "running",
    created: new Date().toISOString(),
    composePath: projectPath,
    builtin: false
  };

  registry.push(newProject);
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(registry, null, 2));
  console.log('✓ Project registered in ServerDash registry');

  // Write credentials output file
  fs.writeFileSync(path.join(sitePath, '.serverdash-freepos.txt'), `=== FreePOS.lk Installed Successfully ===
Domain: https://${domain}
Root Admin Email: ${adminEmail}
Root Admin Password: ${adminPassword}
Supabase Database Port: ${dbPort}
Supabase Studio Port: ${studioPort}
`);

  console.log('\n[BOOTSTRAP] SUCCESS: FreePOS.lk has been successfully configured and started!');
  console.log(`Root Admin Credentials: ${adminEmail} / ${adminPassword}\n`);

} catch (err) {
  console.error('\n[BOOTSTRAP] ERROR: Installation failed:', err.message);
  process.exit(1);
}
