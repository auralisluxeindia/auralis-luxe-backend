import { pool } from '../config/db.js';

export const createProductTables = async () => {
  const categoriesTable = `
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      slug VARCHAR(255) UNIQUE,
      description TEXT,
      parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
      image_url TEXT,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
  `;

  const productsTable = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      price NUMERIC(12,2) NOT NULL,
      category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      sub_category VARCHAR(150),
      carats VARCHAR(50),
      gross_weight NUMERIC(10,3),
      design_code VARCHAR(100),
      purity VARCHAR(50),
      color VARCHAR(50),
      main_image_url TEXT,
      images TEXT[] DEFAULT '{}'::text[],
      views BIGINT DEFAULT 0,
      wishlist_count BIGINT DEFAULT 0,
      sold_count BIGINT DEFAULT 0,
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const productEventsTable = `
    CREATE TABLE IF NOT EXISTS product_events (
      id SERIAL PRIMARY KEY,
      product_id INT REFERENCES products(id) ON DELETE CASCADE,
      event_type VARCHAR(50),
      meta JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_products_title ON products USING gin (to_tsvector('english', coalesce(title,'')));`,
    `CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at);`,
    `DO $$
     BEGIN
       -- Add slug column if missing
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_name='categories' AND column_name='slug'
       ) THEN
         EXECUTE 'ALTER TABLE categories ADD COLUMN slug VARCHAR(255) UNIQUE';
       END IF;

       -- Add index if missing
       IF NOT EXISTS (
         SELECT 1 FROM pg_indexes WHERE indexname='idx_categories_slug'
       ) THEN
         EXECUTE 'CREATE INDEX idx_categories_slug ON categories (slug)';
       END IF;
     END $$;`
  ];

  try {
    await pool.query(categoriesTable);
    await pool.query(productsTable);
    await pool.query(productEventsTable);

    for (const sql of indexes) {
      await pool.query(sql);
    }

    console.log('✅ Tables ensured: users, pending_otps, reset_passwords, pending_admins, admin_profiles, categories, products, product_events');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};
