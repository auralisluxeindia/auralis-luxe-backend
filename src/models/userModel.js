import { pool } from '../config/db.js';

export const createTables = async () => {
  const userTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
      is_verified BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const pendingOtpTable = `
    CREATE TABLE IF NOT EXISTS pending_otps (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      otp VARCHAR(6) NOT NULL,
      otp_expires_at TIMESTAMP NOT NULL,
      otp_attempts INT DEFAULT 1,
      last_otp_sent TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const resetPasswordTable = `
    CREATE TABLE IF NOT EXISTS reset_passwords (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) NOT NULL UNIQUE,
      otp VARCHAR(6) NOT NULL,
      otp_expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

const pendingAdminsTable = `
  CREATE TABLE IF NOT EXISTS pending_admins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    permissions TEXT[],
    invite_token VARCHAR(255),
    invite_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

  const adminPermissionsTable = `
  CREATE TABLE IF NOT EXISTS admin_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT[]
  );
`;

   // Admin profiles — created when pending admin completes signup and becomes a user with role 'admin'
  const adminProfileTable = `
    CREATE TABLE IF NOT EXISTS admin_profiles (
      id SERIAL PRIMARY KEY,
      user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      permissions TEXT[] DEFAULT '{}'::text[],
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const userProfileTable = `
  CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;


  try {
    await pool.query(userTable);
    await pool.query(pendingOtpTable);
    await pool.query(resetPasswordTable);
    await pool.query(pendingAdminsTable);
    await pool.query(adminPermissionsTable);
    await pool.query(adminProfileTable);
    await pool.query(userProfileTable);

    console.log('✅ Tables ensured: users, pending_otps, reset_passwords');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};
