import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const authenticate = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT id, full_name, email, role FROM users WHERE id=$1', [payload.id]);
    if (!result.rows.length) return res.status(401).json({ message: 'Unauthorized' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('Auth Error:', err);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const authorizeRole = (roles = []) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
  next();
};

/**
 * Checks a single permission string.
 * - super_admin bypasses everything
 * - admins: permissions stored in admin_profiles.permissions (text[])
 * - fallback: pending_admins.permissions if admin_profiles not present (for transition)
 */
export const authorizePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    if (req.user.role === 'super_admin') return next();

    // if user is not admin, deny
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Permission denied' });

    // 1) Try admin_profiles (recommended production source)
    const profRes = await pool.query('SELECT permissions FROM admin_profiles WHERE user_id=$1 LIMIT 1', [req.user.id]);
    let perms = profRes.rows[0]?.permissions || null;

    // 2) Fallback: check pending_admins (legacy / invite-only permissions)
    if (!perms) {
      const pendingRes = await pool.query('SELECT permissions FROM pending_admins WHERE email=$1 LIMIT 1', [req.user.email]);
      perms = pendingRes.rows[0]?.permissions || [];
    }

    if (!Array.isArray(perms)) perms = [];

    if (!perms.includes(permission)) {
      return res.status(403).json({ message: 'Permission denied' });
    }

    next();
  } catch (err) {
    console.error('Permission middleware error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};