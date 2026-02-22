CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email_v2 ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_role_v2 ON admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_active_v2 ON admin_users(is_active);

CREATE TABLE IF NOT EXISTS admin_saved_views (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
);
CREATE INDEX IF NOT EXISTS idx_admin_saved_views_admin_scope ON admin_saved_views(admin_user_id, scope);

CREATE TABLE IF NOT EXISTS admin_daily_metrics (
  day TEXT PRIMARY KEY,
  revenue_placed_cents INTEGER NOT NULL DEFAULT 0,
  revenue_completed_cents INTEGER NOT NULL DEFAULT 0,
  revenue_cancelled_cents INTEGER NOT NULL DEFAULT 0,
  orders_placed INTEGER NOT NULL DEFAULT 0,
  orders_completed INTEGER NOT NULL DEFAULT 0,
  orders_cancelled INTEGER NOT NULL DEFAULT 0,
  customers_new INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_type_v2 ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_admin_user_id_v2 ON sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id_v2 ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_v2 ON sessions(expires_at);
