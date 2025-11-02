import { pool } from '../config/db.js';

/**
 * 🟢 Create Category or Subcategory (requires: create_categories)
 */
export const createCategory = async (req, res) => {
  try {
    const { name, description, parent_id, image_url } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required.' });

    const existing = await pool.query(
      `SELECT id FROM categories WHERE name=$1 AND parent_id IS NOT DISTINCT FROM $2`,
      [name, parent_id || null]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Category already exists under this parent.' });

    const result = await pool.query(
      `INSERT INTO categories (name, description, parent_id, image_url, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || null, parent_id || null, image_url || null, req.user?.id || null]
    );

    res.status(201).json({ message: 'Category created successfully.', category: result.rows[0] });
  } catch (err) {
    console.error('❌ Create Category Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

/**
 * 🌍 Get All Categories (nested structure)
 */
export const getCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM categories ORDER BY id ASC`);
    const map = {};
    rows.forEach(cat => (map[cat.id] = { ...cat, subcategories: [] }));

    const rootCategories = [];

    rows.forEach(cat => {
      if (cat.parent_id) {
        map[cat.parent_id]?.subcategories.push(map[cat.id]);
      } else {
        rootCategories.push(map[cat.id]);
      }
    });

    res.status(200).json({
      message: 'Categories fetched successfully.',
      categories: rootCategories
    });
  } catch (err) {
    console.error('❌ Get Categories Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

/**
 * ✏️ Update Category or Subcategory (requires: edit_categories)
 */
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent_id, image_url } = req.body;

    const check = await pool.query('SELECT * FROM categories WHERE id=$1', [id]);
    if (!check.rows.length) return res.status(404).json({ message: 'Category not found.' });

    const result = await pool.query(
      `UPDATE categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           parent_id = COALESCE($3, parent_id),
           image_url = COALESCE($4, image_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id=$5
       RETURNING *`,
      [name, description, parent_id, image_url, id]
    );

    res.status(200).json({ message: 'Category updated successfully.', category: result.rows[0] });
  } catch (err) {
    console.error('❌ Update Category Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

/**
 * 🗑️ Delete Category (requires: delete_categories)
 * ➤ Also deletes all nested subcategories recursively.
 */
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT * FROM categories WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Category not found.' });

    await pool.query(`
      WITH RECURSIVE subcats AS (
        SELECT id FROM categories WHERE id=$1
        UNION ALL
        SELECT c.id FROM categories c INNER JOIN subcats sc ON c.parent_id = sc.id
      )
      DELETE FROM categories WHERE id IN (SELECT id FROM subcats);
    `, [id]);

    res.status(200).json({ message: 'Category and its subcategories deleted successfully.' });
  } catch (err) {
    console.error('❌ Delete Category Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};