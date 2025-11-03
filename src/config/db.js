// db.js
import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const isProduction = process.env.NODE_ENV === 'production';

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, 
  },
  max: isProduction ? 10 : 5,
  idleTimeoutMillis: 30000,  
  connectionTimeoutMillis: 5000, 
});

pool.on('connect', () => {
  console.log('✅ Connected to Supabase PostgreSQL (pooled mode)');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
});

process.on('SIGINT', async () => {
  await pool.end();
  console.log('🧹 Pool closed. Exiting.');
  process.exit(0);
});