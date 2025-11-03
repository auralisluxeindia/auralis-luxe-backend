import { pool } from "../config/db.js";

export const createProductTables = async () => {
  const categoriesTable = `
  CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    description TEXT,
    parent_id INT REFERENCES categories(id) ON DELETE SET NULL,
    image_url TEXT,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_category_per_parent UNIQUE (name, parent_id)
  );

  CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
`;

  const fixCategoryConstraints = `
  DO $$
  BEGIN
    -- Drop old unique constraint if it exists
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'categories_name_key'
    ) THEN
      ALTER TABLE categories DROP CONSTRAINT categories_name_key;
    END IF;

    -- Add new scoped uniqueness (name + parent_id)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'unique_category_per_parent'
    ) THEN
      ALTER TABLE categories ADD CONSTRAINT unique_category_per_parent UNIQUE (name, parent_id);
    END IF;
  END $$;
`;

  const productsTable = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      price NUMERIC(12,2) NOT NULL,
      category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      sub_category_id INT REFERENCES categories(id) ON DELETE SET NULL,
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
      event_type VARCHAR(50) NOT NULL, 
      meta JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const wishlistsTable = `
    CREATE TABLE IF NOT EXISTS wishlists (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, product_id)
    );
  `;

  const cartsTable = `
    CREATE TABLE IF NOT EXISTS carts (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const cartItemsTable = `
    CREATE TABLE IF NOT EXISTS cart_items (
      id SERIAL PRIMARY KEY,
      cart_id INT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(cart_id, product_id)
    );
  `;

  const ordersTable = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const orderItemsTable = `
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      unit_price NUMERIC(12,2) NOT NULL,
      quantity INT NOT NULL,
      total NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);`,
    `CREATE INDEX IF NOT EXISTS idx_products_sub_category_id ON products (sub_category_id);`,

    `CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
    `CREATE INDEX IF NOT EXISTS idx_products_search 
      ON products USING GIN ((LOWER(title) || ' ' || LOWER(description)) gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_categories_name 
      ON categories USING GIN (LOWER(name) gin_trgm_ops);`,
    `CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);`,

    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns 
         WHERE table_name='products' AND column_name='sub_category_id'
       ) THEN
         EXECUTE 'ALTER TABLE products ADD COLUMN sub_category_id INT REFERENCES categories(id) ON DELETE SET NULL';
       END IF;
     END $$;`
  ];

  try {
    await pool.query(categoriesTable);
    await pool.query(fixCategoryConstraints);
    await pool.query(productsTable);
    await pool.query(productEventsTable);
    await pool.query(wishlistsTable);
    await pool.query(cartsTable);
    await pool.query(cartItemsTable);
    await pool.query(ordersTable);
    await pool.query(orderItemsTable);

    for (const sql of indexes) {
      await pool.query(sql);
    }

    console.log(
      "✅ Tables ensured with optimized GIN & trigram indexes for fast product search."
    );
  } catch (error) {
    console.error("❌ Error creating tables:", error);
  }
};