CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

ALTER TABLE sessions ADD COLUMN admin_user_id TEXT;
ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_sessions_admin_user_id ON sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type);

ALTER TABLE products ADD COLUMN image_key TEXT;
ALTER TABLE products ADD COLUMN image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_variants_product_id ON product_variants(product_id);
