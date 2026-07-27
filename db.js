const { Pool } = require('pg');
require('dotenv').config();

// DATABASE_URL comes from your Postgres provider (e.g. Neon, Supabase, Render).
// Example: postgresql://user:password@host/dbname?sslmode=require
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS slots (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      time TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(date, time)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      slot_id INTEGER NOT NULL UNIQUE REFERENCES slots(id) ON DELETE CASCADE,
      ref TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      university TEXT NOT NULL,
      college TEXT NOT NULL,
      department TEXT NOT NULL,
      id_front TEXT NOT NULL,
      id_back TEXT NOT NULL,
      letter TEXT NOT NULL,
      booked_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);

  console.log('✔ Database tables ready');
}

module.exports = { pool, initDb };
