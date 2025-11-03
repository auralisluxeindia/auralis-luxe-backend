import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const isProduction = process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  user: process.env.DB_USER || 'auralis_luxe',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'auralis_luxe_db',
  password: process.env.DB_PASS || 'Test@1234',
  port: process.env.DB_PORT || 5432,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
  process.exit(1);
});