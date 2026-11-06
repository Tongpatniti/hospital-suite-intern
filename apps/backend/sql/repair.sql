-- ===========================================================================
-- ระบบแจ้งซ่อม (design spec v1.3) — Phase 1 Core + SLA + Audit
-- รันซ้ำได้ (IF NOT EXISTS / CREATE OR REPLACE)
-- ต้องรัน sql/init.sql ก่อน (ใช้ person, departments, permissions)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ทะเบียนครุภัณฑ์ย่อ — ฐานข้อมูลฝึกงานยังไม่มีตาราง assets
-- ในระบบจริงให้ใช้ assets เดิม และลบส่วนนี้ออก
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  asset_id          SERIAL PRIMARY KEY,
  asset_code        VARCHAR(50) NOT NULL UNIQUE,
  name              VARCHAR(255) NOT NULL,
  serial_number     VARCHAR(50),
  equipment_type_id INTEGER NOT NULL DEFAULT 3,      -- 1 = MEDICAL, 2 = COMPUTER, อื่นๆ = GENERAL
  department_id     INTEGER REFERENCES departments(department_id),
  custodian_name    VARCHAR(255),
  location          VARCHAR(255),
  status            VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | REPAIRING | DISPOSAL | ...
  purchase_price    NUMERIC(12, 2),
  purchase_date     DATE
);

-- ---------------------------------------------------------------------------
-- 6.1 repair_tickets
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS repair_ticket_no_seq;

CREATE TABLE IF NOT EXISTS repair_tickets (
  ticket_id                 SERIAL PRIMARY KEY,
  ticket_no                 VARCHAR(30) NOT NULL UNIQUE,
  asset_type                VARCHAR(20) NOT NULL CHECK (asset_type IN ('COMPUTER', 'MEDICAL', 'GENERAL')),
  asset_id                  INTEGER REFERENCES assets(asset_id) ON DELETE RESTRICT,
  asset_code_snapshot       VARCHAR(50),
  asset_name_snapshot       VARCHAR(255),
  serial_number_snapshot    VARCHAR(50),
  asset_department_snapshot VARCHAR(255),
  custodian_name_snapshot   VARCHAR(255),
  location_snapshot         VARCHAR(255),
  title                     VARCHAR(255) NOT NULL,
  description               TEXT,
  urgency                   VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  status                    VARCHAR(30) NOT NULL DEFAULT 'NEW',
  status_entered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_warranty               BOOLEAN NOT NULL DEFAULT FALSE,
  asset_status_before       VARCHAR(30),
  close_result              VARCHAR(20) CHECK (close_result IN ('REPAIRED', 'UNREPAIRABLE', 'NOT_FOUND')),
  duplicate_of_ticket_id    INTEGER REFERENCES repair_tickets(ticket_id),
  duplicate_reason          TEXT,
  reopen_count              INTEGER NOT NULL DEFAULT 0,
  requester_id              INTEGER NOT NULL REFERENCES person(person_id) ON DELETE RESTRICT,
  requester_department_id   INTEGER REFERENCES departments(department_id),
  asset_department_id       INTEGER REFERENCES departments(department_id),
  assignee_id               INTEGER REFERENCES person(person_id) ON DELETE RESTRICT,
  created_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_date             TIMESTAMPTZ,
  done_date                 TIMESTAMPTZ,
  closed_date               TIMESTAMPTZ,
  cancelled_date            TIMESTAMPTZ,
  create_by                 INTEGER REFERENCES person(person_id),
  modify_by                 INTEGER REFERENCES person(person_id),
  modify_date               TIMESTAMPTZ,
  CONSTRAINT chk_duplicate_reason CHECK (duplicate_of_ticket_id IS NULL OR duplicate_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_repair_tickets_asset_open
  ON repair_tickets (asset_id) WHERE status NOT IN ('CLOSED', 'CANCELLED');
CREATE INDEX IF NOT EXISTS ix_repair_tickets_sla
  ON repair_tickets (status, status_entered_at) WHERE status NOT IN ('CLOSED', 'CANCELLED');
CREATE INDEX IF NOT EXISTS ix_repair_tickets_asset_created
  ON repair_tickets (asset_id, created_date DESC);
CREATE INDEX IF NOT EXISTS ix_repair_tickets_type_status_created
  ON repair_tickets (asset_type, status, created_date);
CREATE INDEX IF NOT EXISTS ix_repair_tickets_requester ON repair_tickets (requester_id);
CREATE INDEX IF NOT EXISTS ix_repair_tickets_assignee ON repair_tickets (assignee_id);

-- ---------------------------------------------------------------------------
-- 6.2 repair_status_history (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_status_history (
  history_id  SERIAL PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status   VARCHAR(30) NOT NULL,
  remark      TEXT,
  metadata    JSONB,
  changed_by  INTEGER REFERENCES person(person_id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_repair_status_history_ticket ON repair_status_history (ticket_id, changed_at);

-- ---------------------------------------------------------------------------
-- 6.3 repair_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_assignments (
  assignment_id SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  assignee_id   INTEGER NOT NULL REFERENCES person(person_id),
  assigned_by   INTEGER REFERENCES person(person_id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  reason        TEXT
);

-- ---------------------------------------------------------------------------
-- 6.11 repair_evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_evaluations (
  ticket_id    INTEGER PRIMARY KEY REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  score        SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment      TEXT,
  evaluated_by INTEGER REFERENCES person(person_id),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6.12 repair_notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_notifications (
  notification_id SERIAL PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  ticket_id       INTEGER REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  type            VARCHAR(30) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_repair_notifications_person ON repair_notifications (person_id, is_read, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6.13 repair_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  value_type    VARCHAR(10) NOT NULL DEFAULT 'TEXT' CHECK (value_type IN ('NUMBER', 'TEXT', 'BOOLEAN', 'JSON')),
  description   TEXT,
  modify_by     INTEGER REFERENCES person(person_id),
  modify_date   TIMESTAMPTZ
);

INSERT INTO repair_settings (setting_key, setting_value, value_type, description) VALUES
  ('external_quotation_threshold', '5000', 'NUMBER', 'วงเงินที่ต้องมีใบเสนอราคา (บาท)'),
  ('external_quotation_min_count', '2', 'NUMBER', 'จำนวนใบเสนอราคาขั้นต่ำ'),
  ('attach_image_max_mb', '15', 'NUMBER', 'ขนาดรูปสูงสุดตอนอัปโหลด (MB)'),
  ('attach_pdf_max_mb', '10', 'NUMBER', 'ขนาด PDF สูงสุด (MB)'),
  ('attach_max_files_per_ticket', '30', 'NUMBER', 'จำนวนไฟล์สูงสุดต่อใบซ่อม'),
  ('attach_image_max_px', '1920', 'NUMBER', 'ย่อรูปด้านยาวสุด (px)'),
  ('sla_scan_interval_min', '15', 'NUMBER', 'รอบการตรวจงานค้าง (นาที)'),
  ('asset_status_repairing', 'REPAIRING', 'TEXT', 'ค่าสถานะครุภัณฑ์ "อยู่ระหว่างซ่อม"'),
  ('asset_status_disposal', 'DISPOSAL', 'TEXT', 'ค่าสถานะครุภัณฑ์ "รอจำหน่าย"'),
  ('replace_suggest_cost_pct', '50', 'NUMBER', 'ค่าซ่อมสะสม >= X% ของราคาซื้อ → เสนอจำหน่าย'),
  ('replace_suggest_count_12m', '4', 'NUMBER', 'ซ่อม >= N ครั้งใน 12 เดือน → เสนอจำหน่าย')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6.14 repair_sla_rules / 6.15 repair_sla_alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_sla_rules (
  sla_rule_id          SERIAL PRIMARY KEY,
  status               VARCHAR(30) NOT NULL,
  urgency              VARCHAR(20),
  asset_type           VARCHAR(20),
  warn_after_hours     NUMERIC(8, 2) NOT NULL,
  escalate_after_hours NUMERIC(8, 2),
  notify_requester     BOOLEAN NOT NULL DEFAULT TRUE,
  notify_current_actor BOOLEAN NOT NULL DEFAULT TRUE,
  notify_prev_actor    BOOLEAN NOT NULL DEFAULT TRUE,
  escalate_permission  VARCHAR(100),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  modify_by            INTEGER REFERENCES person(person_id),
  modify_date          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_repair_sla_rules_scope
  ON repair_sla_rules (status, COALESCE(urgency, '*'), COALESCE(asset_type, '*'));

INSERT INTO repair_sla_rules (status, urgency, warn_after_hours, escalate_after_hours, notify_requester, notify_current_actor, notify_prev_actor, escalate_permission) VALUES
  ('NEW',           NULL,       24,  48,  TRUE,  TRUE, FALSE, 'repair.lead'),
  ('NEW',           'CRITICAL', 2,   4,   TRUE,  TRUE, FALSE, 'repair.lead'),
  ('ACCEPTED',      NULL,       24,  NULL, TRUE, TRUE, FALSE, NULL),
  ('IN_PROGRESS',   NULL,       72,  120, FALSE, TRUE, FALSE, 'repair.lead'),
  ('WAIT_PART',     NULL,       24,  NULL, FALSE, TRUE, TRUE, NULL),
  ('WAIT_EXTERNAL', NULL,       24,  NULL, FALSE, TRUE, TRUE, NULL),
  ('PART_APPROVAL', NULL,       72,  120, FALSE, TRUE, TRUE, 'repair.supply'),
  ('EXT_APPROVAL',  NULL,       72,  120, FALSE, TRUE, TRUE, 'repair.supply'),
  ('PART_ARRIVED',  NULL,       24,  NULL, FALSE, TRUE, TRUE, NULL),
  ('EXT_RECEIVED',  NULL,       24,  NULL, FALSE, TRUE, TRUE, NULL),
  ('EXT_SENT',      NULL,       336, 720, TRUE,  TRUE, FALSE, 'repair.supply'),
  ('DONE',          NULL,       72,  NULL, TRUE, FALSE, FALSE, NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS repair_sla_alerts (
  alert_id      BIGSERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  history_id    INTEGER NOT NULL REFERENCES repair_status_history(history_id) ON DELETE CASCADE,
  sla_rule_id   INTEGER REFERENCES repair_sla_rules(sla_rule_id) ON DELETE SET NULL,
  status        VARCHAR(30) NOT NULL,
  level         SMALLINT NOT NULL CHECK (level IN (1, 2)),
  hours_overdue NUMERIC(8, 2),
  recipients    INTEGER[] NOT NULL DEFAULT '{}',
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (history_id, level)
);

-- ---------------------------------------------------------------------------
-- 6.16 repair_ticket_watchers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_ticket_watchers (
  ticket_id  INTEGER NOT NULL REFERENCES repair_tickets(ticket_id) ON DELETE CASCADE,
  person_id  INTEGER NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  source     VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('DUPLICATE', 'MANUAL')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, person_id)
);

-- ---------------------------------------------------------------------------
-- 6.17 repair_audit_logs (append-only) + trigger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_audit_logs (
  log_id         BIGSERIAL PRIMARY KEY,
  table_name     VARCHAR(63) NOT NULL,
  record_id      TEXT NOT NULL,
  ticket_id      INTEGER,
  action         VARCHAR(10) NOT NULL,
  old_values     JSONB,
  new_values     JSONB,
  changed_fields TEXT[],
  reason         TEXT,
  changed_by     INTEGER,
  db_user        TEXT NOT NULL DEFAULT current_user,
  ip_address     TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_repair_audit_record ON repair_audit_logs (table_name, record_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_repair_audit_ticket ON repair_audit_logs (ticket_id);
CREATE INDEX IF NOT EXISTS ix_repair_audit_changed_at ON repair_audit_logs (changed_at);

-- TG_ARGV[0] = ชื่อคอลัมน์ PK, TG_ARGV[1] = 'reason' ถ้าบังคับเหตุผลเมื่อ UPDATE,
-- TG_ARGV[2..] = คอลัมน์ที่ต้องเก็บ (ไม่ระบุ = ทุกคอลัมน์)
CREATE OR REPLACE FUNCTION repair_audit_trigger() RETURNS trigger AS $$
DECLARE
  v_pk        TEXT := TG_ARGV[0];
  v_need_rsn  BOOLEAN := TG_ARGV[1] = 'reason';
  v_cols      TEXT[] := CASE WHEN TG_NARGS > 2 THEN TG_ARGV[2:TG_NARGS - 1] ELSE NULL END;
  v_old       JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new       JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row       JSONB := COALESCE(v_new, v_old);
  v_fields    TEXT[];
  v_reason    TEXT := NULLIF(current_setting('app.reason', true), '');
  v_user      TEXT := NULLIF(current_setting('app.user_id', true), '');
  v_old_f     JSONB := '{}';
  v_new_f     JSONB := '{}';
  k           TEXT;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v_row) LOOP
    IF v_cols IS NULL OR k = ANY (v_cols) THEN
      IF TG_OP <> 'UPDATE' OR (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN
        v_fields := array_append(v_fields, k);
        IF v_old IS NOT NULL THEN v_old_f := v_old_f || jsonb_build_object(k, v_old -> k); END IF;
        IF v_new IS NOT NULL THEN v_new_f := v_new_f || jsonb_build_object(k, v_new -> k); END IF;
      END IF;
    END IF;
  END LOOP;

  IF TG_OP = 'UPDATE' AND v_fields IS NULL THEN
    RETURN NEW;  -- ไม่มีคอลัมน์ในขอบเขตเปลี่ยน
  END IF;
  IF TG_OP = 'UPDATE' AND v_need_rsn AND v_reason IS NULL THEN
    RAISE EXCEPTION 'กรุณาระบุเหตุผลการแก้ไข (%.%)', TG_TABLE_NAME, array_to_string(v_fields, ',')
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO repair_audit_logs (table_name, record_id, ticket_id, action, old_values, new_values,
                                 changed_fields, reason, changed_by, ip_address)
  VALUES (TG_TABLE_NAME, v_row ->> v_pk,
          CASE WHEN v_row ? 'ticket_id' THEN (v_row ->> 'ticket_id')::INT END,
          TG_OP,
          CASE WHEN v_old IS NOT NULL THEN v_old_f END,
          CASE WHEN v_new IS NOT NULL THEN v_new_f END,
          v_fields, v_reason, v_user::INT,
          NULLIF(current_setting('app.ip', true), ''));
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION repair_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_audit_immutable ON repair_audit_logs;
CREATE TRIGGER trg_repair_audit_immutable BEFORE UPDATE OR DELETE ON repair_audit_logs
  FOR EACH ROW EXECUTE FUNCTION repair_append_only();

DROP TRIGGER IF EXISTS trg_repair_history_immutable ON repair_status_history;
CREATE TRIGGER trg_repair_history_immutable BEFORE UPDATE ON repair_status_history
  FOR EACH ROW EXECUTE FUNCTION repair_append_only();

DROP TRIGGER IF EXISTS trg_audit_repair_settings ON repair_settings;
CREATE TRIGGER trg_audit_repair_settings AFTER INSERT OR UPDATE OR DELETE ON repair_settings
  FOR EACH ROW EXECUTE FUNCTION repair_audit_trigger('setting_key', 'reason', 'setting_value');

DROP TRIGGER IF EXISTS trg_audit_repair_sla_rules ON repair_sla_rules;
CREATE TRIGGER trg_audit_repair_sla_rules AFTER INSERT OR UPDATE OR DELETE ON repair_sla_rules
  FOR EACH ROW EXECUTE FUNCTION repair_audit_trigger('sla_rule_id', 'reason',
    'status', 'urgency', 'asset_type', 'warn_after_hours', 'escalate_after_hours',
    'notify_requester', 'notify_current_actor', 'notify_prev_actor', 'escalate_permission', 'is_active');

-- สถานะครุภัณฑ์ที่ระบบซ่อมเปลี่ยน (ไม่บังคับ reason แต่ application ใส่เลขใบซ่อมให้)
DROP TRIGGER IF EXISTS trg_audit_assets_status ON assets;
CREATE TRIGGER trg_audit_assets_status AFTER UPDATE OF status ON assets
  FOR EACH ROW EXECUTE FUNCTION repair_audit_trigger('asset_id', 'none', 'status');

-- ---------------------------------------------------------------------------
-- 6.18 v_asset_repair_summary (Phase 1: ยังไม่มีค่าอะไหล่/ซ่อมนอก)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_asset_repair_summary AS
SELECT t.asset_id,
       COUNT(*)::INT                                                                   AS repair_count,
       (COUNT(*) FILTER (WHERE t.created_date >= NOW() - INTERVAL '12 months'))::INT   AS repair_count_12m,
       MAX(t.created_date)                                                             AS last_repair_date,
       ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(t.closed_date, NOW()) - t.created_date)) / 86400)::NUMERIC, 1)
                                                                                       AS downtime_days,
       ROUND(AVG(ev.score)::NUMERIC, 2)                                                AS avg_score
  FROM repair_tickets t
  LEFT JOIN repair_evaluations ev USING (ticket_id)
 WHERE t.asset_id IS NOT NULL
   AND t.status <> 'CANCELLED'
 GROUP BY t.asset_id;
