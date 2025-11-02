import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { sendEmail } from '../utils/sendEmail.js';
import { generateToken } from '../utils/generateToken.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const signup = async (req, res) => {
    try {
        const { full_name, email, password } = req.body;
        if (!full_name || !email || !password)
            return res.status(400).json({ message: 'All fields are required.' });

        const existingUser = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        if (existingUser.rows.length)
            return res.status(400).json({ message: 'User already exists.' });

        const pending = await pool.query('SELECT * FROM pending_otps WHERE email=$1', [email]);
        const now = new Date();

        if (pending.rows.length) {
            const userOtp = pending.rows[0];
            const diff = (now - new Date(userOtp.last_otp_sent)) / 1000; // in seconds

            if (userOtp.otp_attempts >= 3 && diff < 60) {
                const wait = Math.ceil(60 - diff);
                return res.status(429).json({ message: `Too many attempts. Try again in ${wait}s.` });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

            await pool.query(
                `UPDATE pending_otps 
         SET otp=$1, otp_expires_at=$2, otp_attempts=$3, last_otp_sent=$4 
         WHERE email=$5`,
                [otp, otpExpires, userOtp.otp_attempts + 1, now, email]
            );

            await sendEmail(
                email,
                'Auralis Luxe – Verify Your Email',
                `
  <div style="font-family: 'Segoe UI', Roboto, Arial, sans-serif; background-color:#f8f6f4; padding:40px 0;">
    <div style="max-width: 600px; background-color:#ffffff; margin:auto; border-radius:16px; box-shadow:0 2px 10px rgba(0,0,0,0.05); overflow:hidden;">
      <div style="background-color:#ffffff; padding:20px 0; text-align:center;">
        <img src="https://i.ibb.co/4ZjPNjJT/auralis-luxe-logo.png" 
             alt="Auralis Luxe Logo"
             style="height:50px; object-fit:contain;"/>
      </div>

      <div style="padding: 32px;">
        <h2 style="color:#222; font-size:20px; font-weight:600;">Verify Your Email</h2>
        <p style="color:#555; font-size:15px; line-height:1.6;">
          Hi <strong>${full_name}</strong>,
        </p>
        <p style="color:#555; font-size:15px; line-height:1.6;">
          Welcome to <strong>Auralis Luxe</strong> your trusted destination for timeless elegance.  
          To complete your registration, please verify your email using the OTP below:
        </p>

        <div style="text-align:center; margin:28px 0;">
          <div style="
            display:inline-block;
            background-color:#e4a1b2;
            color:#000;
            padding:14px 28px;
            border-radius:10px;
            font-size:24px;
            font-weight:600;
            letter-spacing:4px;
          ">
            ${otp}
          </div>
        </div>

        <p style="color:#777; font-size:14px; line-height:1.6;">
          This OTP will expire in <strong>10 minutes</strong>.  
          If you didn’t request this, please ignore this email your account will remain safe.
        </p>

        <div style="margin-top:30px; color:#999; font-size:13px;">
          <p style="margin:0;">Warm regards,</p>
          <p style="margin:0;"><strong>The Auralis Luxe Team</strong></p>
          <p style="margin-top:8px;">
            <a href="https://auralisluxe.vercel.com" style="color:#e4a1b2; text-decoration:none;">auralisluxe.vercel.com</a>
          </p>
        </div>
      </div>

      <div style="background-color:#f2f2f2; padding:16px; text-align:center; font-size:12px; color:#888;">
        © ${new Date().getFullYear()} Auralis Luxe. All rights reserved.
      </div>
    </div>
  </div>
  `
            );


            return res.status(200).json({ message: 'OTP resent successfully.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            `INSERT INTO pending_otps (full_name, email, password, otp, otp_expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
            [full_name, email, hashedPassword, otp, otpExpires]
        );

        res.status(201).json({ message: 'OTP sent to your email.' });
    } catch (error) {
        console.error('Signup Error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp)
            return res.status(400).json({ message: 'Email and OTP are required.' });

        const existingUser = await pool.query('SELECT * FROM users WHERE email=$1', [email]); // Existing user check

        if (existingUser.rows.length && existingUser.rows[0].is_verified) {
            return res.status(400).json({ message: 'Account already verified. Please log in.' });
        }

        const pendingResult = await pool.query('SELECT * FROM pending_otps WHERE email=$1', [email]); // Pending OTP check
        if (!pendingResult.rows.length) {
            return res.status(404).json({ message: 'No pending verification found. Please sign up again.' });
        }

        const pending = pendingResult.rows[0];

        if (new Date() > new Date(pending.otp_expires_at)) {
            await pool.query('DELETE FROM pending_otps WHERE email=$1', [email]); // Cleanup expired OTP
            return res.status(400).json({ message: 'OTP expired. Please request a new one.' });
        }

        if (pending.otp !== otp) {
            await pool.query(
                `UPDATE pending_otps SET attempts = COALESCE(attempts,0) + 1 WHERE email=$1`,
                [email]
            );

            const attemptCheck = await pool.query('SELECT attempts FROM pending_otps WHERE email=$1', [email]);
            if (attemptCheck.rows[0].attempts >= 3) {
                await pool.query('DELETE FROM pending_otps WHERE email=$1', [email]);
                return res.status(429).json({ message: 'Too many incorrect attempts. Please try again after 1 minute.' });
            }

            return res.status(400).json({ message: 'Invalid OTP. Please check and try again.' });
        }

        let role = 'user';
        if (email === 'yasinverse@gmail.com') {
            const superAdminCheck = await pool.query(
                `SELECT * FROM users WHERE role='super_admin' LIMIT 1`
            );
            if (superAdminCheck.rows.length === 0) {
                role = 'super_admin';
            } else {
                return res.status(403).json({ message: 'Super admin already exists.' });
            }
        }

        const insertUser = await pool.query(
            `INSERT INTO users (full_name, email, password, role, is_verified)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id, full_name, email, role, created_at`,
            [pending.full_name, pending.email, pending.password, role]
        );

        await pool.query('DELETE FROM pending_otps WHERE email=$1', [email]);

        const token = generateToken(insertUser.rows[0]);

        res.status(200).json({
            message: 'Email verified successfully!',
            token,
            user: insertUser.rows[0],
        });
    } catch (error) {
        console.error('OTP Verification Error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];

    if (!user)
      return res.status(404).json({ message: 'Account not found. Please sign up first.' });

    if (!user.is_verified)
      return res.status(403).json({ message: 'Account not verified. Please verify OTP first.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: 'Invalid password.' });

    let permissions = [];
    if (user.role === 'admin') {
      const permRes = await pool.query(
        'SELECT permissions FROM admin_permissions WHERE user_id=$1',
        [user.id]
      );
      permissions = permRes.rows[0]?.permissions || [];
    }

    const token = generateToken(user);

    res.status(200).json({
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        permissions,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ message: 'Email is required.' });

        const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
        const user = result.rows[0];

        if (!user)
            return res.status(404).json({ message: 'No account found with this email.' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(`
      CREATE TABLE IF NOT EXISTS reset_passwords (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        otp_expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        await pool.query(
            `INSERT INTO reset_passwords (email, otp, otp_expires_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (email)
       DO UPDATE SET otp=$2, otp_expires_at=$3, created_at=NOW()`,
            [email, otp, otpExpires]
        );

        await sendEmail(email, 'Auralis Luxe – Password Reset Request', `
      <div style="font-family: Arial; background: #ffffff; padding: 20px; border-radius: 12px;">
        <img src="https://i.ibb.co/4ZjPNjJT/auralis-luxe-logo.png" alt="Auralis Luxe" width="100"/>
        <h2 style="color:#222;">Reset Your Password</h2>
        <p>We received a request to reset your password. Use this OTP:</p>
        <h1 style="color:#5b3fff;">${otp}</h1>
        <p>This OTP expires in 10 minutes.</p>
        <p>If you didn’t request this, please ignore this email.</p>
        <p style="font-size:12px;color:#777;">© ${new Date().getFullYear()} Auralis Luxe</p>
      </div>
    `);

        res.status(200).json({ message: 'Password reset OTP sent to your email.' });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const resetPassword = async (req, res) => {
    try {
        const { email, otp, new_password } = req.body;

        if (!email || !otp || !new_password)
            return res.status(400).json({ message: 'All fields are required.' });

        const result = await pool.query('SELECT * FROM reset_passwords WHERE email=$1', [email]);
        const record = result.rows[0];

        if (!record)
            return res.status(404).json({ message: 'No reset request found for this email.' });

        if (new Date() > new Date(record.otp_expires_at))
            return res.status(400).json({ message: 'OTP expired.' });

        if (record.otp !== otp)
            return res.status(400).json({ message: 'Invalid OTP.' });

        const hashedPassword = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hashedPassword, email]);
        await pool.query('DELETE FROM reset_passwords WHERE email=$1', [email]);

        res.status(200).json({ message: 'Password reset successful! Please log in again.' });
    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const inviteAdmin = async (req, res) => {
  try {
    const { name, email, permissions } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name & email required' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24*60*60*1000);

    await pool.query(`
      INSERT INTO pending_admins (name, email, permissions, invite_token, invite_expires_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (email) DO UPDATE SET permissions=$3, invite_token=$4, invite_expires_at=$5, created_at=NOW()
    `, [name, email, permissions || [], token, expires]);

    const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/admin/invite?token=${token}`;

    await sendEmail(email, 'Auralis Luxe — Admin Invite', `
      <p>Hi ${name},</p>
      <p>You were invited as an admin on Auralis Luxe. Click to complete signup:</p>
      <a href="${inviteLink}">${inviteLink}</a>
      <p>Permissions: ${ (permissions||[]).join(', ') }</p>
    `);

    res.status(200).json({ message: 'Admin invited.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};


export const completeAdminSignup = async (req, res) => {
  try {
    const { token, password } = req.body;
    console.log(req.body);

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required.' });
    }

    const result = await pool.query(
      'SELECT * FROM pending_admins WHERE invite_token=$1',
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ message: 'Invalid or expired invite token.' });
    }

    const invite = result.rows[0];
    if (new Date() > new Date(invite.invite_expires_at)) {
      await pool.query('DELETE FROM pending_admins WHERE invite_token=$1', [token]);
      return res.status(400).json({ message: 'Invite token expired. Please request a new invite.' });
    }

    const existingUser = await pool.query(
      'SELECT id, email, role FROM users WHERE email=$1',
      [invite.email]
    );

    let user;
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
      await pool.query(
        `UPDATE users SET role='admin', is_verified=true WHERE email=$1`,
        [invite.email]
      );
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const insertUser = await pool.query(
        `INSERT INTO users (full_name, email, password, role, is_verified)
         VALUES ($1, $2, $3, 'admin', true)
         RETURNING id, full_name, email, role, created_at`,
        [invite.name, invite.email, hashedPassword]
      );
      user = insertUser.rows[0];
    }

    const existingPerm = await pool.query(
      'SELECT * FROM admin_permissions WHERE user_id=$1',
      [user.id]
    );

    if (existingPerm.rows.length > 0) {
      await pool.query(
        'UPDATE admin_permissions SET permissions=$2 WHERE user_id=$1',
        [user.id, invite.permissions || []]
      );
    } else {
      await pool.query(
        'INSERT INTO admin_permissions (user_id, permissions) VALUES ($1, $2)',
        [user.id, invite.permissions || []]
      );
    }

    await pool.query('DELETE FROM pending_admins WHERE invite_token=$1', [token]);

    const accessToken = jwt.sign(
      { id: user.id, role: 'admin', email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const permRes = await pool.query(
      'SELECT permissions FROM admin_permissions WHERE user_id=$1',
      [user.id]
    );
    const permissions = permRes.rows[0]?.permissions || [];

    res.status(201).json({
      message: 'Admin account created or updated successfully!',
      user: {
        ...user,
        permissions,
      },
      access_token: accessToken,
    });
  } catch (error) {
    console.error('❌ Admin Signup Error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const listAdmins = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.created_at, 
              ap.permissions
       FROM users u
       LEFT JOIN admin_permissions ap ON u.id = ap.user_id
       WHERE u.role = 'admin'
       ORDER BY u.created_at DESC`
    );

    res.status(200).json({
      message: 'Admin list fetched successfully.',
      admins: result.rows || [],
    });
  } catch (err) {
    console.error('❌ List Admins Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const removeAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const check = await pool.query(
      `SELECT id, email, role FROM users WHERE id=$1`,
      [id]
    );

    if (!check.rows.length)
      return res.status(404).json({ message: 'Admin not found.' });

    const user = check.rows[0];

    if (user.role !== 'admin')
      return res.status(400).json({ message: 'User is not an admin.' });

    await pool.query('DELETE FROM admin_permissions WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);

    res.status(200).json({ message: `Admin ${user.email} removed successfully.` });
  } catch (err) {
    console.error('❌ Remove Admin Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

