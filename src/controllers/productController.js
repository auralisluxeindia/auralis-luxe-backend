import { pool } from '../config/db.js';
import { uploadBufferToR2, deleteObjectFromR2, getKeyFromUrl } from '../utils/r2.js';
import slugify from 'slugify';
import crypto from 'crypto';
import multer from "multer";
import XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage() });

const makeUniqueSlug = async (base) => {
  let slug = slugify(base, { lower: true, strict: true });
  if (!slug) slug = `product-${crypto.randomBytes(4).toString('hex')}`;
  let exists = await pool.query('SELECT id FROM products WHERE slug=$1', [slug]);
  let suffix = 1;
  while (exists.rows.length) {
    const candidate = `${slug}-${suffix++}`;
    exists = await pool.query('SELECT id FROM products WHERE slug=$1', [candidate]);
    if (!exists.rows.length) {
      slug = candidate;
      break;
    }
  }
  return slug;
};


export const uploadCategoryImage = [
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded." });

      const file = req.file;
      const key = `categories/${Date.now()}-${file.originalname}`;

      const imageUrl = await uploadBufferToR2(key, file.buffer, file.mimetype);

      res.status(200).json({
        message: "Image uploaded successfully.",
        image_url: imageUrl,
      });
    } catch (err) {
      console.error("❌ Upload to R2 failed:", err);
      res.status(500).json({ message: "Failed to upload image." });
    }
  },
];

/**
 * 🟢 Create Category or Subcategory (requires: create_categories)
 */
export const createCategory = async (req, res) => {
  const client = await pool.connect();

  try {
    const { name, description, parent_id, image_url, subcategories = [] } = req.body;

    if (!name) return res.status(400).json({ message: "Category name is required." });

    await client.query("BEGIN");

    const mainCategoryRes = await client.query(
      `INSERT INTO categories (name, description, parent_id, image_url, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description || null, parent_id || null, image_url || null, req.user?.id || null]
    );

    const mainCategory = mainCategoryRes.rows[0];

    if (Array.isArray(subcategories) && subcategories.length > 0) {
      const insertPromises = subcategories.map((sub) =>
        client.query(
          `INSERT INTO categories (name, description, parent_id, image_url, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [sub, null, mainCategory.id, null, req.user?.id || null]
        )
      );
      await Promise.all(insertPromises);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Category and subcategories created successfully.",
      category: mainCategory,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Create Category Error:", err);
    res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};


/**
 * 🌍 Get All Categories (nested structure)
 */
export const getCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM categories ORDER BY id ASC`);
    const map = {};
    rows.forEach((cat) => (map[cat.id] = { ...cat, subcategories: [] }));

    const rootCategories = [];

    rows.forEach((cat) => {
      if (cat.parent_id) {
        map[cat.parent_id]?.subcategories.push(map[cat.id]);
      } else {
        rootCategories.push(map[cat.id]);
      }
    });

    res.status(200).json({
      message: "Categories fetched successfully.",
      categories: rootCategories,
    });
  } catch (err) {
    console.error("❌ Get Categories Error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};


/**
 * ✏️ Update Category or Subcategory (requires: edit_categories)
 */
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent_id, image_url } = req.body;

    const check = await pool.query("SELECT * FROM categories WHERE id=$1", [id]);
    if (!check.rows.length) return res.status(404).json({ message: "Category not found." });

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

    res.status(200).json({
      message: "Category updated successfully.",
      category: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Update Category Error:", err);
    res.status(500).json({ message: "Internal server error." });
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

export const createProduct = async (req, res) => {
  try {
    const {
        title, description, price, category_id, sub_category_id,
        carats, gross_weight, design_code, purity, color
        } = req.body;


    if (!title || !price || !category_id) {
      return res.status(400).json({ message: 'Title, price and category_id are required.' });
    }

    const slug = await makeUniqueSlug(title);

    const files = req.files || [];
    const uploadedUrls = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `products/${slug}/${Date.now()}-${i}-${file.originalname.replace(/\s+/g,'_')}`;
      const url = await uploadBufferToR2(key, file.buffer, file.mimetype);
      uploadedUrls.push(url);
    }

    const main_image_url = uploadedUrls[0] || null;
    const images = uploadedUrls;

    const result = await pool.query(
  `INSERT INTO products
    (title, slug, description, price, category_id, sub_category_id, carats, gross_weight, design_code, purity, color, main_image_url, images, created_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   RETURNING *`,
  [title, slug, description || null, price, category_id, sub_category_id || null,
   carats || null, gross_weight || null, design_code || null, purity || null, color || null,
   main_image_url, images, req.user?.id || null]
);

    res.status(201).json({ message: 'Product created.', product: result.rows[0] });
  } catch (err) {
    console.error('Create Product Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const getProductBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query('SELECT * FROM products WHERE slug=$1', [slug]);
    if (!result.rows.length) return res.status(404).json({ message: 'Product not found.' });
    const product = result.rows[0];
    res.status(200).json({ product });
  } catch (err) {
    console.error('Get Product Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const listProducts = async (req, res) => {

  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit ?? '12', 10));
    const offset = (page - 1) * limit;


    const sortOptions = {
      price_desc: 'p.price DESC',
      price_asc: 'p.price ASC',
      newest: 'p.created_at DESC',
      popular: 'COALESCE(p.views, 0) DESC',
    };
    const sort = sortOptions[req.query.sort] || sortOptions.newest;

    const q = req.query.q?.trim().toLowerCase() || null;
    const category = req.query.category?.trim().toLowerCase() || null;


    const conditions = [];
    const values = [];
    let idx = 1;

    if (q) {
      values.push(`%${q}%`);
      idx++;
    }

  if (category && category !== 'search-results') {
  conditions.push(`(LOWER(c.slug) = LOWER($${idx}) OR LOWER(c.name) = LOWER($${idx}))`);
  values.push(category);
  idx++;
}


    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countQuery = `
      SELECT COUNT(*)::INT AS total
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${whereClause}
    `;


    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0]?.total ?? 0;

    console.log('📊 Total Products Found:', total);

    const dataQuery = `
      SELECT 
        p.id, p.title, p.price, p.images, p.description,
        p.carats, p.gross_weight, p.views,
        c.name AS category_name, c.slug AS category_slug,
        sc.name AS sub_category_name, sc.slug AS sub_category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN categories sc ON sc.id = p.sub_category_id
      ${whereClause}
      ORDER BY ${sort}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    values.push(limit, offset);

    
    const dataRes = await pool.query(dataQuery, values);


    res.status(200).json({
      total,
      page,
      limit,
      products: dataRes.rows,
    });

  } catch (err) {
    console.error('🔥 [listProducts] Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};



export const searchProducts = async (req, res) => {
  try {
    const query = req.query.q ? req.query.q.trim().toLowerCase() : '';
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || '12', 10));
    const offset = (page - 1) * limit;

    if (!query) {
      return res.status(400).json({ message: 'Search query is required.' });
    }

    // Using trigram similarity for flexible search
    const sql = `
      WITH matched AS (
        SELECT 
          p.*, 
          c.name AS category_name, 
          sc.name AS sub_category_name,
          GREATEST(
            similarity(LOWER(p.title), $1),
            similarity(LOWER(c.name), $1),
            similarity(LOWER(sc.name), $1)
          ) AS score
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
        WHERE 
          LOWER(p.title) ILIKE '%' || $1 || '%'
          OR LOWER(p.description) ILIKE '%' || $1 || '%'
          OR LOWER(c.name) ILIKE '%' || $1 || '%'
          OR LOWER(sc.name) ILIKE '%' || $1 || '%'
        ORDER BY score DESC, p.created_at DESC
        LIMIT $2 OFFSET $3
      )
      SELECT * FROM matched;
    `;

    const countSql = `
      SELECT COUNT(*)::INT AS total
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
      WHERE 
        LOWER(p.title) ILIKE '%' || $1 || '%'
        OR LOWER(p.description) ILIKE '%' || $1 || '%'
        OR LOWER(c.name) ILIKE '%' || $1 || '%'
        OR LOWER(sc.name) ILIKE '%' || $1 || '%';
    `;

    const [dataRes, countRes] = await Promise.all([
      pool.query(sql, [query, limit, offset]),
      pool.query(countSql, [query])
    ]);

    res.status(200).json({
      total: countRes.rows[0].total,
      page,
      limit,
      query,
      products: dataRes.rows
    });

  } catch (err) {
    console.error('Search Products Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    const existing = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Product not found.' });
    const product = existing.rows[0];

    const files = req.files || [];
    const uploadedUrls = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `products/${product.slug}/${Date.now()}-${i}-${file.originalname.replace(/\s+/g,'_')}`;
      const url = await uploadBufferToR2(key, file.buffer, file.mimetype);
      uploadedUrls.push(url);
    }

    let images = product.images || [];
    if (uploadedUrls.length) images = [...uploadedUrls, ...images];

    const main_image_url = payload.main_image_url || images[0] || product.main_image_url;

    const updateQuery = `
      UPDATE products SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        category_id = COALESCE($4, category_id),
        sub_category_id = COALESCE($5, sub_category_id),
        carats = COALESCE($6, carats),
        gross_weight = COALESCE($7, gross_weight),
        design_code = COALESCE($8, design_code),
        purity = COALESCE($9, purity),
        color = COALESCE($10, color),
        main_image_url = $11,
        images = $12,
        updated_at = CURRENT_TIMESTAMP
      WHERE id=$13
      RETURNING *`;
    const values = [
      payload.title || null,
      payload.description || null,
      payload.price || null,
      payload.category_id || null,
      payload.sub_category_id || null,
      payload.carats || null,
      payload.gross_weight || null,
      payload.design_code || null,
      payload.purity || null,
      payload.color || null,
      main_image_url,
      images,
      id
    ];

    const updated = await pool.query(updateQuery, values);
    res.status(200).json({ message: 'Product updated.', product: updated.rows[0] });
  } catch (err) {
    console.error('Update Product Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Product not found.' });

    const product = existing.rows[0];
    const images = product.images || [];

    for (const url of images) {
      const key = getKeyFromUrl(url);
      if (key) {
        try { await deleteObjectFromR2(key); } catch (e) { console.warn('Failed delete:', key, e.message); }
      }
    }
    await pool.query('DELETE FROM products WHERE id=$1', [id]);

    res.status(200).json({ message: 'Product deleted and images removed.' });
  } catch (err) {
    console.error('Delete Product Error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};





export const addToWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ message: 'product_id is required.' });

    await pool.query('BEGIN');

    // create wishlist row (ignore duplicate)
    await pool.query(
      `INSERT INTO wishlists (user_id, product_id) VALUES ($1,$2)
       ON CONFLICT (user_id, product_id) DO NOTHING`,
      [userId, product_id]
    );

    // increment wishlist counter only if newly inserted
    const inserted = (await pool.query(
      `SELECT 1 FROM wishlists WHERE user_id=$1 AND product_id=$2`,
      [userId, product_id]
    )).rows.length;

    // To avoid race, increment unconditionally using GREATEST check is insufficient to decide new insertion.
    // Simpler: try to increment only when the row didn't exist before the INSERT.
    // We'll check count of rows for that user/product before insert — but here we already inserted.
    // Safer approach: use RETURNING in insert — but ON CONFLICT DO NOTHING returns no row if conflict.
    // Instead: attempt increment only when we inserted => check if there is more than 0 and also whether wishlist_count changed.
    // We'll run a conditional increment using a separate query that increments if there is at least one wishlist row and product.wishlist_count < current_count+1 is hard.
    // Simpler pragmatic approach: increment using an UPSERT into a helper table is complex. We'll attempt to increment using a cheap select check for existence BEFORE the insert.

    // To do this robustly, let's re-implement with pre-check:
    await pool.query('ROLLBACK'); // rollback current transaction and redo properly below

    await pool.query('BEGIN');
    const before = (await pool.query('SELECT 1 FROM wishlists WHERE user_id=$1 AND product_id=$2', [userId, product_id])).rows.length;
    if (before === 0) {
      // insert then increment
      await pool.query('INSERT INTO wishlists (user_id, product_id) VALUES ($1,$2)', [userId, product_id]);
      await pool.query('UPDATE products SET wishlist_count = wishlist_count + 1 WHERE id=$1', [product_id]);
      await pool.query(
        `INSERT INTO product_events (product_id, event_type, meta) VALUES ($1, 'wishlist_add', $2)`,
        [product_id, JSON.stringify({ user_id: userId })]
      );
    }

    await pool.query('COMMIT');
    return res.status(200).json({ message: 'Added to wishlist.' });
  } catch (err) {
    console.error('Add to wishlist error:', err);
    await pool.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ message: 'product_id is required.' });

    await pool.query('BEGIN');

    const existed = (await pool.query('SELECT id FROM wishlists WHERE user_id=$1 AND product_id=$2', [userId, product_id])).rows.length;
    if (!existed) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Wishlist item not found.' });
    }

    await pool.query('DELETE FROM wishlists WHERE user_id=$1 AND product_id=$2', [userId, product_id]);
    await pool.query('UPDATE products SET wishlist_count = GREATEST(wishlist_count - 1, 0) WHERE id=$1', [product_id]);
    await pool.query(
      `INSERT INTO product_events (product_id, event_type, meta) VALUES ($1, 'wishlist_remove', $2)`,
      [product_id, JSON.stringify({ user_id: userId })]
    );

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Removed from wishlist.' });
  } catch (err) {
    console.error('Remove wishlist error:', err);
    await pool.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const getWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = (await pool.query(`
      SELECT p.*, w.created_at as added_at
      FROM wishlists w
      JOIN products p ON p.id = w.product_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [userId])).rows;
    res.status(200).json({ items: rows });
  } catch (err) {
    console.error('Get wishlist error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

// --------------- CART ----------------

export const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity = 1 } = req.body;
    if (!product_id || quantity <= 0) return res.status(400).json({ message: 'product_id and positive quantity required.' });

    await pool.query('BEGIN');

    // ensure cart exists
    let cart = (await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId])).rows[0];
    if (!cart) {
      const r = await pool.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING *', [userId]);
      cart = r.rows[0];
    }

    // upsert cart_items: increment quantity if exists else insert
    await pool.query(`
      INSERT INTO cart_items (cart_id, product_id, quantity)
      VALUES ($1,$2,$3)
      ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
    `, [cart.id, product_id, quantity]);

    await pool.query(`INSERT INTO product_events (product_id, event_type, meta) VALUES ($1,'cart_add',$2)`, [product_id, JSON.stringify({ user_id: userId, quantity })]);

    await pool.query('COMMIT');
    res.status(200).json({ message: 'Added to cart.' });
  } catch (err) {
    console.error('Add to cart error:', err);
    await pool.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const updateCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, quantity } = req.body;
    if (!product_id || !quantity || quantity <= 0) return res.status(400).json({ message: 'product_id and positive quantity required.' });

    const cart = (await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId])).rows[0];
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });

    const result = await pool.query(`
      UPDATE cart_items SET quantity=$1, updated_at=CURRENT_TIMESTAMP
      WHERE cart_id=$2 AND product_id=$3 RETURNING *
    `, [quantity, cart.id, product_id]);

    if (!result.rows.length) return res.status(404).json({ message: 'Cart item not found.' });

    await pool.query(`INSERT INTO product_events (product_id, event_type, meta) VALUES ($1,'cart_update',$2)`, [product_id, JSON.stringify({ user_id: userId, quantity })]);

    res.status(200).json({ message: 'Cart item updated.', item: result.rows[0] });
  } catch (err) {
    console.error('Update cart error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const removeCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ message: 'product_id is required.' });

    const cart = (await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId])).rows[0];
    if (!cart) return res.status(404).json({ message: 'Cart not found.' });

    const deleted = (await pool.query('DELETE FROM cart_items WHERE cart_id=$1 AND product_id=$2 RETURNING *', [cart.id, product_id])).rows[0];
    if (!deleted) return res.status(404).json({ message: 'Cart item not found.' });

    await pool.query(`INSERT INTO product_events (product_id, event_type, meta) VALUES ($1,'cart_remove',$2)`, [product_id, JSON.stringify({ user_id: userId })]);

    res.status(200).json({ message: 'Cart item removed.' });
  } catch (err) {
    console.error('Remove cart item error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = (await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId])).rows[0];
    if (!cart) return res.status(200).json({ items: [], total: 0 });

    const items = (await pool.query(`
      SELECT ci.id, ci.quantity, p.id as product_id, p.title, p.price, p.main_image_url
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1
    `, [cart.id])).rows;

    // compute total
    const total = items.reduce((s, it) => s + parseFloat(it.price) * it.quantity, 0);
    res.status(200).json({ items, total });
  } catch (err) {
    console.error('Get cart error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const createOrderFromCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { metadata } = req.body;

    await pool.query('BEGIN');

    const cart = (await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId])).rows[0];
    if (!cart) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    const items = (await pool.query(`
      SELECT ci.product_id, ci.quantity, p.price
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = $1
    `, [cart.id])).rows;

    if (!items.length) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ message: 'Cart is empty.' });
    }

    let total = 0;
    items.forEach(it => total += parseFloat(it.price) * it.quantity);

    const orderRes = await pool.query(
      `INSERT INTO orders (user_id, total, status, metadata) VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, total, 'pending', metadata ? JSON.stringify(metadata) : null]
    );
    const order = orderRes.rows[0];

    // insert order items and increment sold_count and product_events
    for (const it of items) {
      const unitPrice = parseFloat(it.price);
      const qty = parseInt(it.quantity, 10);
      const t = unitPrice * qty;
      await pool.query(`INSERT INTO order_items (order_id, product_id, unit_price, quantity, total) VALUES ($1,$2,$3,$4,$5)`, [order.id, it.product_id, unitPrice, qty, t]);

      await pool.query('UPDATE products SET sold_count = COALESCE(sold_count,0) + $1 WHERE id=$2', [qty, it.product_id]);

      // event
      await pool.query(`INSERT INTO product_events (product_id, event_type, meta) VALUES ($1,'order_item',$2)`, [it.product_id, JSON.stringify({ user_id: userId, quantity: qty, order_id: order.id })]);
    }

    await pool.query('DELETE FROM cart_items WHERE cart_id=$1', [cart.id]);

    await pool.query('COMMIT');
    res.status(201).json({ message: 'Order created.', order_id: order.id });
  } catch (err) {
    console.error('Create order error:', err);
    await pool.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = (await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows;
    res.status(200).json({ orders });
  } catch (err) {
    console.error('Get user orders error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const getOrderDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const order = (await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, userId])).rows[0];
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const items = (await pool.query('SELECT * FROM order_items WHERE order_id=$1', [id])).rows;
    res.status(200).json({ order, items });
  } catch (err) {
    console.error('Get order details error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};

export const listAllOrders = async (req, res) => {
  try {
    const rows = (await pool.query('SELECT o.*, u.full_name, u.email FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC')).rows;
    res.status(200).json({ orders: rows });
  } catch (err) {
    console.error('List all orders error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const recordProductView = async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) {
      return res.status(400).json({ message: 'product_id required.' });
    }

    const check = await pool.query('SELECT id FROM products WHERE id = $1', [product_id]);
    if (check.rowCount === 0) {
      return res.status(200).json({ message: 'Product not found, skipping view record.' });
    }

    await pool.query('BEGIN');

    // ✅ Safe view increment
    await pool.query('UPDATE products SET views = COALESCE(views, 0) + 1 WHERE id = $1', [product_id]);

    // ✅ Log the event
    await pool.query(
      `INSERT INTO product_events (product_id, event_type, meta)
       VALUES ($1, 'view', $2)`,
      [product_id, JSON.stringify({ ip: req.ip, user_id: req.user?.id || null })]
    );

    await pool.query('COMMIT');

    res.status(200).json({ message: 'View recorded successfully.' });
  } catch (err) {
    console.error('Record view error:', err);
    await pool.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const getTrendingProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 12;

    const trendingQuery = `
      (
        SELECT id, title, price, images, category_id, sub_category_id, carats, gross_weight, views
        FROM products
        WHERE COALESCE(views, 0) > 0
        ORDER BY views DESC
        LIMIT $1
      )
      UNION ALL
      (
        SELECT id, title, price, images, category_id, sub_category_id, carats, gross_weight, views
        FROM products
        WHERE COALESCE(views, 0) = 0
        ORDER BY id DESC
        LIMIT $1
      )
      LIMIT $1
    `;

    const result = await pool.query(trendingQuery, [limit]);

    if (result.rows.length === 0) {
      return res.status(200).json({ items: [] });
    }

    return res.status(200).json({ items: result.rows });
  } catch (err) {
    console.error('Error fetching trending products:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};




export const getUserDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(400).json({ message: 'Invalid user ID.' });
    const userResult = await pool.query(
      `SELECT id, full_name, email, role, created_at FROM users WHERE id=$1`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ message: 'User not found' });

    let profile = {};
    try {
      const profileResult = await pool.query(
        `SELECT phone, address FROM user_profiles WHERE user_id=$1`,
        [userId]
      );
      profile = profileResult.rows[0] || {};
    } catch {
      profile = {};
    }
    let cart = { total_items: 0, total_quantity: 0 };
    try {
      const cartResult = await pool.query(
        `SELECT COUNT(*) AS total_items, COALESCE(SUM(ci.quantity), 0) AS total_quantity
         FROM carts c
         LEFT JOIN cart_items ci ON ci.cart_id = c.id
         WHERE c.user_id=$1`,
        [userId]
      );
      cart = {
        total_items: parseInt(cartResult.rows[0]?.total_items || 0),
        total_quantity: parseInt(cartResult.rows[0]?.total_quantity || 0),
      };
    } catch {
      cart = { total_items: 0, total_quantity: 0 };
    }
    let wishlistCount = 0;
    try {
      const wishlistResult = await pool.query(
        `SELECT COUNT(*) AS total_items FROM wishlists WHERE user_id=$1`,
        [userId]
      );
      wishlistCount = parseInt(wishlistResult.rows[0]?.total_items || 0);
    } catch {
      wishlistCount = 0;
    }
    res.status(200).json({
      message: 'User details fetched successfully',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: profile.phone || null,
        address: profile.address || null,
      },
      cart,
      wishlist: { total_items: wishlistCount },
    });

  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};



export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { full_name, phone, address } = req.body;

    if (!userId) return res.status(400).json({ message: 'Invalid user ID.' });
    if (full_name) {
      await pool.query(`UPDATE users SET full_name=$1 WHERE id=$2`, [full_name, userId]);
    }
    try {
      await pool.query(
        `INSERT INTO user_profiles (user_id, phone, address)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id)
         DO UPDATE SET 
           phone = EXCLUDED.phone,
           address = EXCLUDED.address`,
        [userId, phone || null, address || null]
      );
    } catch (err) {
      console.warn('⚠️ user_profiles table missing or not ready:', err.message);
    }

    res.status(200).json({ message: 'Profile updated successfully.' });
  } catch (error) {
    console.error('❌ Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};


export const bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No Excel file uploaded." });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);

    const success = [];
    const failed = [];

    for (const [index, row] of rows.entries()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const title = row["Title"]?.trim();
        const description = row["Description"] || null;
        const price = parseFloat(row["Price"]) || null;
        const categoryName = row["Category Name"]?.trim();
        const subCategoryName = row["Sub Category Name"]?.trim();
        const imageFiles = row["Image Files"]?.split(",").map(s => s.trim()) || [];
        const carats = parseFloat(row["Carats"]) || null;
        const grossWeight = parseFloat(row["Gross Weight"]) || null;
        const designCode = row["Design Code"]?.trim() || null;
        const purity = row["Purity"]?.trim() || null;
        const color = row["Colour"]?.trim() || null;

        if (!title || !price || !categoryName) {
          failed.push({ row: index + 2, reason: "Missing title, price or category." });
          await client.query("ROLLBACK");
          client.release();
          continue;
        }
        let categoryId;
        const catRes = await client.query(
          `SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND parent_id IS NULL`,
          [categoryName]
        );

        if (catRes.rows.length > 0) {
          categoryId = catRes.rows[0].id;
        } else {
          const slug = categoryName.toLowerCase().replace(/\s+/g, "-");
          const newCat = await client.query(
            `INSERT INTO categories (name, slug, parent_id)
             VALUES ($1, $2, NULL)
             RETURNING id`,
            [categoryName, slug]
          );
          categoryId = newCat.rows[0].id;
        }
        let subCategoryId = null;
        if (subCategoryName) {
          const subRes = await client.query(
            `SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND parent_id=$2`,
            [subCategoryName, categoryId]
          );

          if (subRes.rows.length > 0) {
            subCategoryId = subRes.rows[0].id;
          } else {
            const slug = subCategoryName.toLowerCase().replace(/\s+/g, "-");
            const newSub = await client.query(
              `INSERT INTO categories (name, slug, parent_id)
               VALUES ($1, $2, $3)
               RETURNING id`,
              [subCategoryName, slug, categoryId]
            );
            subCategoryId = newSub.rows[0].id;
          }
        }
        const uploadedUrls = [];
        for (const img of imageFiles) {
          if (!img) continue;
          if (img.startsWith("http")) {
            uploadedUrls.push(img);
          } else if (req.filesMap?.[img]) {
            const fileBuffer = req.filesMap[img].buffer;
            const key = `products/${Date.now()}-${img}`;
            const url = await uploadBufferToR2(key, fileBuffer, req.filesMap[img].mimetype);
            uploadedUrls.push(url);
          } else {
            console.warn(`⚠️ Skipping missing image for ${title}: ${img}`);
          }
        }

        const mainImage = uploadedUrls[0] || null;
        const slug = await makeUniqueSlug(title);
        const result = await client.query(
          `INSERT INTO products 
           (title, slug, description, price, category_id, sub_category_id, carats, gross_weight, design_code, purity, color, main_image_url, images)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            title,
            slug,
            description,
            price,
            categoryId,
            subCategoryId,
            carats,
            grossWeight,
            designCode,
            purity,
            color,
            mainImage,
            uploadedUrls,
          ]
        );

        await client.query("COMMIT");
        client.release();

        success.push({ row: index + 2, product_id: result.rows[0].id });
      } catch (err) {
        await client.query("ROLLBACK");
        client.release();
        console.error(`Row ${index + 2} failed:`, err.message);
        failed.push({ row: index + 2, reason: err.message });
      }
    }

    return res.status(200).json({
      message: "Bulk upload completed.",
      totalRows: rows.length,
      successCount: success.length,
      failedCount: failed.length,
      failed,
    });
  } catch (err) {
    console.error("Bulk Upload Error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const generateProductReport = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "productIds must be a non-empty array" });
    }

    const { rows: products } = await pool.query(
      `
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.description,
        p.price,
        p.views AS total_views,
        p.wishlist_count,
        p.sold_count,
        c.name AS category_name,
        p.created_at
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ANY($1::int[])
      ORDER BY p.id;
      `,
      [productIds]
    );

    if (products.length === 0) {
      return res.status(404).json({ message: "No products found for given IDs" });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Product Report");

    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Title", key: "title", width: 30 },
      { header: "Slug", key: "slug", width: 25 },
      { header: "Category", key: "category_name", width: 20 },
      { header: "Price", key: "price", width: 12 },
      { header: "Wishlist Count", key: "wishlist_count", width: 15 },
      { header: "Total Views", key: "total_views", width: 15 },
      { header: "Sold Count", key: "sold_count", width: 15 },
      { header: "Created At", key: "created_at", width: 20 },
    ];

    products.forEach((p) => worksheet.addRow(p));

    const header = worksheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { horizontal: "center" };

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=product-report-${Date.now()}.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Error generating product report:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


