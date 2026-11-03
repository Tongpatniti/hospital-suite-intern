-- ===========================================================================
-- Training database schema (mtp_training)
-- โครงสร้างย่อของระบบจริง — พอสำหรับฝึกทำโมดูลใหม่ + ใช้ระบบ login/สิทธิ์/SSO
-- ===========================================================================

CREATE TABLE IF NOT EXISTS departments (
  department_id SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  name_en       TEXT
);

CREATE TABLE IF NOT EXISTS person (
  person_id     SERIAL PRIMARY KEY,
  firstname     TEXT NOT NULL,
  lastname      TEXT,
  firstname_en  TEXT,
  lastname_en   TEXT,
  person_type   CHAR(1) NOT NULL DEFAULT '2', -- '1' = admin, '2' = user
  department_id INTEGER REFERENCES departments(department_id),
  create_date   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login (
  login_id        SERIAL PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES person(person_id),
  username        TEXT NOT NULL UNIQUE,
  password        TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_date TIMESTAMPTZ,
  create_date     TIMESTAMPTZ DEFAULT NOW(),
  modify_date     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id  SERIAL PRIMARY KEY,
  permission_key TEXT NOT NULL UNIQUE,
  module_name    TEXT,
  description    TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  role_id   SERIAL PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  login_id INTEGER NOT NULL REFERENCES login(login_id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  PRIMARY KEY (login_id, role_id)
);

CREATE TABLE IF NOT EXISTS sso_sessions (
  token      TEXT PRIMARY KEY,
  login_id   INTEGER NOT NULL REFERENCES login(login_id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('hub', 'app')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_sessions_token_kind ON sso_sessions(token, kind);

-- ตารางตัวอย่างของโมดูลฝึกงาน (ใช้เป็นแม่แบบ)
CREATE TABLE IF NOT EXISTS training_items (
  item_id     SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT,
  price       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  note        TEXT,
  create_by   TEXT,
  create_date TIMESTAMPTZ DEFAULT NOW(),
  modify_by   TEXT,
  modify_date TIMESTAMPTZ
);
