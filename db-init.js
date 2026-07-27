// Run this ONCE after deployment to create the database tables
// and the first admin account: node db-init.js
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
require('dotenv').config();

async function run() {
  await initDb();

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const existing = await pool.query('SELECT id FROM admins WHERE username=$1', [username]);
  if (existing.rows.length > 0) {
    console.log('✔ Admin account already exists, skipping creation.');
  } else {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admins (username, password_hash) VALUES ($1,$2)', [username, hash]);
    console.log(`✔ Admin account created -> username: ${username} / password: ${password}`);
    console.log('  IMPORTANT: change this password after your first login.');
  }

  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
