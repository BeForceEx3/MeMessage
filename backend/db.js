const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      socket_id TEXT UNIQUE,
      name VARCHAR(50),
      age INTEGER,
      gender VARCHAR(10),
      preferred_gender VARCHAR(10),
      age_group VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id),
      receiver_id INTEGER REFERENCES users(id),
      content TEXT,
      is_audio BOOLEAN DEFAULT false,
      audio_url TEXT,
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database initialized');
};

module.exports = { pool, initDB };
