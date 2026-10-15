#!/usr/bin/env node
/**
 * ServerDash Emergency Passkey Reset CLI
 * Run locally on VPS over SSH:
 *   node scripts/reset-passkey.js
 */
const path = require('path')
const fs = require('fs')

const DB_DIR = path.join(__dirname, '..', 'data')
const dbFile = path.join(DB_DIR, 'auth.db')

if (!fs.existsSync(dbFile)) {
  console.log('No auth.db database found. ServerDash has not been initialized yet.')
  process.exit(0)
}

try {
  const Database = require('better-sqlite3')
  const db = new Database(dbFile)
  db.exec('DELETE FROM admin_passkey; DELETE FROM admin_sessions;')
  console.log('✓ SUCCESS: All registered passkeys and active sessions have been cleared.')
  console.log('You can now open the ServerDash panel and register a new primary admin Passkey.')
} catch (err) {
  console.error('✗ ERROR resetting passkey:', err.message)
  process.exit(1)
}
