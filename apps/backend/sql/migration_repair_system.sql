-- =================================================================
-- Migration: ระบบแจ้งซ่อมพัสดุ/ครุภัณฑ์ (Repair System) v1.2
-- Database: mtp
--
-- ตารางเดิมที่ใช้ร่วม:
--   assets, equipment_types, equipment_categories, brands,
--   departments, person, organizations, fund_types,
--   permissions, roles, role_permissions, user_permissions
--
-- วิธีใช้:
--   psql -d mtp -f apps/backend/sql/migration_repair_system.sql
--
-- หมายเหตุ:
--   - ไฟล์นี้ safe to re-run ด้วย CREATE TABLE IF NOT EXISTS / ON CONFLICT
--   - ไม่ seed approval rules เพราะวงเงิน/ขั้นอนุมัติต้องรอที่ประชุมยืนยัน
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- 0. Sequence สำหรับเลขใบซ่อม
-- application ใช้ nextval แล้ว format เป็น RP-<YY><4-digit>
-- -----------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.repair_ticket_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

COMMENT ON SEQUENCE public.repair_ticket_no_seq
    IS 'ลำดับเลขใบแจ้งซ่อม ใช้สร้าง ticket_no รูปแบบ RP-YYNNNN';

-- -----------------------------------------------------------------
-- 1. ใบแจ้งซ่อม
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_tickets (
    ticket_id SERIAL PRIMARY KEY,
    ticket_no VARCHAR(30) NOT NULL UNIQUE,
    asset_type VARCHAR(20) NOT NULL
        CHECK (asset_type IN ('COMPUTER', 'MEDICAL', 'GENERAL')),
    asset_id INTEGER REFERENCES public.assets(asset_id) ON DELETE RESTRICT,
    asset_code_snapshot VARCHAR(50),
    asset_name_snapshot VARCHAR(255),
    serial_number_snapshot VARCHAR(50),
    asset_department_snapshot VARCHAR(255),
    custodian_name_snapshot VARCHAR(255),
    location_snapshot VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    urgency VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
        CHECK (urgency IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    status VARCHAR(30) NOT NULL DEFAULT 'NEW'
        CHECK (status IN (
            'NEW',
            'ACCEPTED',
            'IN_PROGRESS',
            'WAIT_PART',
            'PART_APPROVAL',
            'PART_PURCHASING',
            'PART_ARRIVED',
            'WAIT_EXTERNAL',
            'EXT_APPROVAL',
            'EXT_SENT',
            'EXT_RECEIVED',
            'DONE',
            'CLOSED',
            'CANCELLED'
        )),
    is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
    requester_id INTEGER NOT NULL REFERENCES public.person(person_id) ON DELETE RESTRICT,
    requester_department_id INTEGER REFERENCES public.departments(department_id) ON DELETE SET NULL,
    asset_department_id INTEGER REFERENCES public.departments(department_id) ON DELETE SET NULL,
    assignee_id INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    created_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    accepted_date TIMESTAMP WITH TIME ZONE,
    done_date TIMESTAMP WITH TIME ZONE,
    closed_date TIMESTAMP WITH TIME ZONE,
    cancelled_date TIMESTAMP WITH TIME ZONE,
    create_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_tickets IS 'ใบแจ้งซ่อมพัสดุ/ครุภัณฑ์';
COMMENT ON COLUMN public.repair_tickets.ticket_no IS 'เลขใบแจ้งซ่อม รูปแบบ RP-YYNNNN';
COMMENT ON COLUMN public.repair_tickets.asset_type IS 'ประเภทงานซ่อม: COMPUTER, MEDICAL, GENERAL';
COMMENT ON COLUMN public.repair_tickets.asset_id IS 'FK ไปยัง assets; NULL ได้สำหรับพัสดุที่ไม่มีรหัสครุภัณฑ์';
COMMENT ON COLUMN public.repair_tickets.asset_code_snapshot IS 'รหัสครุภัณฑ์ ณ วันที่แจ้ง';
COMMENT ON COLUMN public.repair_tickets.asset_name_snapshot IS 'ชื่อครุภัณฑ์ ณ วันที่แจ้ง';
COMMENT ON COLUMN public.repair_tickets.asset_department_snapshot IS 'ชื่อแผนกเจ้าของครุภัณฑ์ ณ วันที่แจ้ง';
COMMENT ON COLUMN public.repair_tickets.custodian_name_snapshot IS 'ชื่อผู้ดูแลครุภัณฑ์ ณ วันที่แจ้ง';
COMMENT ON COLUMN public.repair_tickets.requester_department_id IS 'แผนกของผู้แจ้ง';
COMMENT ON COLUMN public.repair_tickets.asset_department_id IS 'แผนกเจ้าของครุภัณฑ์';
COMMENT ON COLUMN public.repair_tickets.assignee_id IS 'ช่างผู้รับผิดชอบคนปัจจุบัน';

CREATE INDEX IF NOT EXISTS idx_repair_tickets_type_status
    ON public.repair_tickets (asset_type, status, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_requester
    ON public.repair_tickets (requester_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_assignee
    ON public.repair_tickets (assignee_id, status, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_asset
    ON public.repair_tickets (asset_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_open
    ON public.repair_tickets (created_date)
    WHERE status NOT IN ('CLOSED', 'CANCELLED');

-- -----------------------------------------------------------------
-- 2. ประวัติการเปลี่ยนสถานะ (append-only)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_status_history (
    history_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    from_status VARCHAR(30)
        CHECK (from_status IS NULL OR from_status IN (
            'NEW',
            'ACCEPTED',
            'IN_PROGRESS',
            'WAIT_PART',
            'PART_APPROVAL',
            'PART_PURCHASING',
            'PART_ARRIVED',
            'WAIT_EXTERNAL',
            'EXT_APPROVAL',
            'EXT_SENT',
            'EXT_RECEIVED',
            'DONE',
            'CLOSED',
            'CANCELLED'
        )),
    to_status VARCHAR(30) NOT NULL
        CHECK (to_status IN (
            'NEW',
            'ACCEPTED',
            'IN_PROGRESS',
            'WAIT_PART',
            'PART_APPROVAL',
            'PART_PURCHASING',
            'PART_ARRIVED',
            'WAIT_EXTERNAL',
            'EXT_APPROVAL',
            'EXT_SENT',
            'EXT_RECEIVED',
            'DONE',
            'CLOSED',
            'CANCELLED'
        )),
    remark TEXT,
    metadata JSONB,
    changed_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.repair_status_history IS 'ประวัติการเปลี่ยนสถานะใบแจ้งซ่อม (append-only)';
COMMENT ON COLUMN public.repair_status_history.metadata IS 'ข้อมูลเพิ่มเติมของ transition เช่น assignee/vendor/amount';

CREATE INDEX IF NOT EXISTS idx_repair_status_history_ticket
    ON public.repair_status_history (ticket_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_status_history_status
    ON public.repair_status_history (to_status, changed_at DESC);

-- -----------------------------------------------------------------
-- 3. ประวัติการมอบหมายช่าง
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_assignments (
    assignment_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    assignee_id INTEGER NOT NULL REFERENCES public.person(person_id) ON DELETE RESTRICT,
    assigned_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    unassigned_at TIMESTAMP WITH TIME ZONE,
    reason TEXT
);

COMMENT ON TABLE public.repair_assignments IS 'ประวัติการมอบหมาย/เปลี่ยนช่างของใบแจ้งซ่อม';

CREATE INDEX IF NOT EXISTS idx_repair_assignments_ticket
    ON public.repair_assignments (ticket_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_assignments_assignee
    ON public.repair_assignments (assignee_id, unassigned_at);

-- -----------------------------------------------------------------
-- 4. อะไหล่
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_parts (
    part_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    part_name VARCHAR(255) NOT NULL,
    part_no VARCHAR(100),
    qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    unit VARCHAR(30),
    estimated_unit_price NUMERIC(12, 2) CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0),
    actual_unit_price NUMERIC(12, 2) CHECK (actual_unit_price IS NULL OR actual_unit_price >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN (
            'REQUESTED',
            'PENDING_APPROVAL',
            'APPROVED',
            'PURCHASING',
            'ARRIVED',
            'ISSUED',
            'USED',
            'CANCELLED'
        )),
    requested_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    requested_date TIMESTAMP WITH TIME ZONE,
    approved_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    approved_date TIMESTAMP WITH TIME ZONE,
    ordered_date TIMESTAMP WITH TIME ZONE,
    arrived_date TIMESTAMP WITH TIME ZONE,
    issued_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    create_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_parts IS 'รายการอะไหล่ที่ต้องใช้ในใบแจ้งซ่อม';
COMMENT ON COLUMN public.repair_parts.status IS 'สถานะอะไหล่: REQUESTED/PENDING_APPROVAL/APPROVED/PURCHASING/ARRIVED/ISSUED/USED/CANCELLED';

CREATE INDEX IF NOT EXISTS idx_repair_parts_ticket
    ON public.repair_parts (ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_parts_status
    ON public.repair_parts (status, create_date DESC);

-- -----------------------------------------------------------------
-- 5. งานซ่อมภายนอก / Vendor
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_externals (
    external_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'SUGGESTED'
        CHECK (status IN (
            'SUGGESTED',
            'SELECTED',
            'PENDING_APPROVAL',
            'APPROVED',
            'SENT',
            'RETURNED',
            'COMPLETED',
            'CANCELLED'
        )),
    is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
    suggested_org_id INTEGER REFERENCES public.organizations(org_id) ON DELETE SET NULL,
    suggested_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    suggested_date TIMESTAMP WITH TIME ZONE,
    suggested_reason TEXT,
    selected_org_id INTEGER REFERENCES public.organizations(org_id) ON DELETE SET NULL,
    selected_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    selected_date TIMESTAMP WITH TIME ZONE,
    selection_reason TEXT,
    approved_amount NUMERIC(12, 2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
    actual_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
    transport_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
    other_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (other_fee >= 0),
    fund_type_id INTEGER REFERENCES public.fund_types(fund_type_id) ON DELETE SET NULL,
    sent_date DATE,
    return_date DATE,
    invoice_no VARCHAR(50),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID'
        CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'CANCELLED')),
    notes TEXT,
    create_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_externals IS 'งานซ่อมภายนอก/ส่งซ่อมร้านค้า';
COMMENT ON COLUMN public.repair_externals.suggested_org_id IS 'ร้านที่ช่างเสนอ ( organizations.type = vendor )';
COMMENT ON COLUMN public.repair_externals.selected_org_id IS 'ร้านที่พัสดุเลือก ( organizations.type = vendor )';
COMMENT ON COLUMN public.repair_externals.payment_status IS 'สถานะจ่ายเงิน: UNPAID/PENDING/PAID/CANCELLED';

CREATE INDEX IF NOT EXISTS idx_repair_externals_ticket
    ON public.repair_externals (ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_externals_suggested_org
    ON public.repair_externals (suggested_org_id, suggested_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_externals_selected_org
    ON public.repair_externals (selected_org_id, selected_date DESC);

CREATE TABLE IF NOT EXISTS public.repair_vendor_history (
    history_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    external_id INTEGER REFERENCES public.repair_externals(external_id) ON DELETE SET NULL,
    action VARCHAR(20) NOT NULL
        CHECK (action IN ('SUGGEST', 'SELECT', 'CHANGE')),
    org_id INTEGER NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
    reason TEXT,
    created_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    created_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.repair_vendor_history IS 'ประวัติการเสนอ/เลือกร้านแบบ append-only เพื่อตรวจย้อนหลัง';
COMMENT ON COLUMN public.repair_vendor_history.action IS 'SUGGEST = ช่างเสนอ, SELECT = พัสดุเลือก, CHANGE = เปลี่ยนร้าน';

CREATE INDEX IF NOT EXISTS idx_repair_vendor_history_ticket
    ON public.repair_vendor_history (ticket_id, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_vendor_history_org
    ON public.repair_vendor_history (org_id, created_date DESC);

CREATE TABLE IF NOT EXISTS public.repair_quotations (
    quotation_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    external_id INTEGER REFERENCES public.repair_externals(external_id) ON DELETE SET NULL,
    org_id INTEGER NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
    quotation_no VARCHAR(100),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    received_date DATE,
    valid_until DATE,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    select_reason TEXT,
    created_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    created_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_quotations IS 'ใบเสนอราคาซ่อมภายนอก';
COMMENT ON COLUMN public.repair_quotations.org_id IS 'FK ไปยัง organizations (type = vendor)';
COMMENT ON COLUMN public.repair_quotations.is_selected IS 'TRUE = ใบเสนอราคาที่เลือกใช้';

CREATE INDEX IF NOT EXISTS idx_repair_quotations_ticket
    ON public.repair_quotations (ticket_id, amount);
CREATE INDEX IF NOT EXISTS idx_repair_quotations_external
    ON public.repair_quotations (external_id);
CREATE INDEX IF NOT EXISTS idx_repair_quotations_org
    ON public.repair_quotations (org_id, created_date DESC);

-- -----------------------------------------------------------------
-- 6. กฎการอนุมัติ
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_approval_rules (
    rule_id SERIAL PRIMARY KEY,
    request_type VARCHAR(20) NOT NULL
        CHECK (request_type IN ('PART', 'EXTERNAL')),
    asset_type VARCHAR(20)
        CHECK (asset_type IS NULL OR asset_type IN ('COMPUTER', 'MEDICAL', 'GENERAL')),
    department_id INTEGER REFERENCES public.departments(department_id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    min_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
    max_amount NUMERIC(12, 2)
        CHECK (max_amount IS NULL OR max_amount > min_amount),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    create_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    create_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_approval_rules IS 'กฎอนุมัติตามประเภทงาน (PART/EXTERNAL) และช่วงวงเงิน';
COMMENT ON COLUMN public.repair_approval_rules.max_amount IS 'NULL = ไม่จำกัดเพดาน';
COMMENT ON COLUMN public.repair_approval_rules.asset_type IS 'NULL = ใช้กับทุกประเภท';
COMMENT ON COLUMN public.repair_approval_rules.department_id IS 'NULL = ใช้กับทุกแผนก';

CREATE INDEX IF NOT EXISTS idx_repair_approval_rules_type_active
    ON public.repair_approval_rules (request_type, is_active, min_amount);

CREATE TABLE IF NOT EXISTS public.repair_approval_steps (
    step_id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES public.repair_approval_rules(rule_id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order > 0),
    approver_type VARCHAR(30) NOT NULL
        CHECK (approver_type IN ('supply_head', 'department_head', 'director', 'person')),
    approver_person_id INTEGER REFERENCES public.person(person_id) ON DELETE RESTRICT,
    step_title VARCHAR(100),
    can_return BOOLEAN NOT NULL DEFAULT TRUE,
    can_reject BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (rule_id, step_order),
    CHECK (approver_type <> 'person' OR approver_person_id IS NOT NULL)
);

COMMENT ON TABLE public.repair_approval_steps IS 'ขั้นอนุมัติของแต่ละกฎ';
COMMENT ON COLUMN public.repair_approval_steps.approver_type IS 'supply_head/department_head/director/person';

CREATE INDEX IF NOT EXISTS idx_repair_approval_steps_rule
    ON public.repair_approval_steps (rule_id, step_order);

CREATE TABLE IF NOT EXISTS public.repair_approval_requests (
    request_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    request_type VARCHAR(20) NOT NULL
        CHECK (request_type IN ('PART', 'EXTERNAL')),
    rule_id INTEGER REFERENCES public.repair_approval_rules(rule_id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
    requested_by INTEGER NOT NULL REFERENCES public.person(person_id) ON DELETE RESTRICT,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_approval_requests IS 'รอบการขออนุมัติ แยกจาก approval steps เพื่อรองรับการยื่นใหม่หลังตีกลับ';

CREATE INDEX IF NOT EXISTS idx_repair_approval_requests_ticket
    ON public.repair_approval_requests (ticket_id, request_type, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_approval_requests_status
    ON public.repair_approval_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS public.repair_approvals (
    approval_id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES public.repair_approval_requests(request_id) ON DELETE CASCADE,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    step_id INTEGER REFERENCES public.repair_approval_steps(step_id) ON DELETE SET NULL,
    step_order INTEGER NOT NULL CHECK (step_order > 0),
    approver_person_id INTEGER NOT NULL REFERENCES public.person(person_id) ON DELETE RESTRICT,
    action VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (action IN ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'SKIPPED')),
    comment TEXT,
    acted_at TIMESTAMP WITH TIME ZONE,
    created_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, step_order)
);

COMMENT ON TABLE public.repair_approvals IS 'ประวัติการอนุมัติรายขั้นของแต่ละรอบคำขอ';
COMMENT ON COLUMN public.repair_approvals.action IS 'PENDING/APPROVED/RETURNED/REJECTED/SKIPPED';

CREATE INDEX IF NOT EXISTS idx_repair_approvals_request
    ON public.repair_approvals (request_id, step_order);
CREATE INDEX IF NOT EXISTS idx_repair_approvals_approver
    ON public.repair_approvals (approver_person_id, action, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_repair_approvals_ticket
    ON public.repair_approvals (ticket_id, created_date DESC);

-- -----------------------------------------------------------------
-- 7. ไฟล์แนบ
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_attachments (
    attachment_id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    reference_type VARCHAR(20) NOT NULL
        CHECK (reference_type IN ('TICKET', 'STATUS', 'PART', 'QUOTATION', 'EXTERNAL', 'EVALUATION')),
    reference_id INTEGER,
    file_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100),
    file_size BIGINT CHECK (file_size IS NULL OR file_size >= 0),
    uploaded_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.repair_attachments IS 'ไฟล์แนบของงานซ่อมแบบ generic ตาม reference_type/reference_id';
COMMENT ON COLUMN public.repair_attachments.reference_id IS 'id ของ STATUS/PART/QUOTATION/EXTERNAL/EVALUATION หรือ ticket_id เมื่อ type=TICKET';

CREATE INDEX IF NOT EXISTS idx_repair_attachments_ticket
    ON public.repair_attachments (ticket_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_attachments_reference
    ON public.repair_attachments (reference_type, reference_id);

-- -----------------------------------------------------------------
-- 8. ประเมินความพึงพอใจ
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_evaluations (
    ticket_id INTEGER PRIMARY KEY REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    evaluated_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.repair_evaluations IS 'ผลประเมินความพึงพอใจหลังปิดงาน 1-5 ดาว';

-- -----------------------------------------------------------------
-- 9. การแจ้งเตือน (in-app)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_notifications (
    notification_id SERIAL PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES public.person(person_id) ON DELETE CASCADE,
    ticket_id INTEGER NOT NULL REFERENCES public.repair_tickets(ticket_id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.repair_notifications IS 'การแจ้งเตือนในระบบสำหรับผู้เกี่ยวข้องกับงานซ่อม';

CREATE INDEX IF NOT EXISTS idx_repair_notifications_person
    ON public.repair_notifications (person_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_notifications_ticket
    ON public.repair_notifications (ticket_id, created_at DESC);

-- -----------------------------------------------------------------
-- 10. ตั้งค่าระบบซ่อม
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    description TEXT,
    modify_by INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL,
    modify_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.repair_settings IS 'ค่าตั้งต้นของระบบซ่อม เช่น threshold ใบเสนอราคา';

INSERT INTO public.repair_settings (setting_key, setting_value, description)
VALUES
    ('external_quotation_threshold', '5000', 'วงเงินที่ต้องแนบใบเสนอราคา >= 2 เจ้า (ค่าตั้งต้น รอที่ประชุมยืนยัน)'),
    ('external_quotation_min_count', '2', 'จำนวนใบเสนอราคาขั้นต่ำเมื่อถึง threshold (ค่าตั้งต้น รอที่ประชุมยืนยัน)')
ON CONFLICT (setting_key) DO NOTHING;

-- -----------------------------------------------------------------
-- 11. Permissions
-- -----------------------------------------------------------------
INSERT INTO public.permissions (permission_key, module_name, description)
VALUES
    ('repair.computer.request', 'Repair', 'แจ้งซ่อมคอมพิวเตอร์'),
    ('repair.medical.request', 'Repair', 'แจ้งซ่อมเครื่องมือแพทย์'),
    ('repair.general.request', 'Repair', 'แจ้งซ่อมทั่วไป'),
    ('repair.computer.tech', 'Repair', 'รับงาน/ดำเนินการซ่อมคอมพิวเตอร์'),
    ('repair.medical.tech', 'Repair', 'รับงาน/ดำเนินการซ่อมเครื่องมือแพทย์'),
    ('repair.other.tech', 'Repair', 'รับงาน/ดำเนินการซ่อมทั่วไป'),
    ('repair.supply', 'Repair', 'จัดการพัสดุ/จัดซื้อ/ร้านค้าของงานซ่อม'),
    ('repair.approve', 'Repair', 'อนุมัติคำขอซ่อม/จัดซื้ออะไหล่/ส่งซ่อมนอก'),
    ('repair.all', 'Repair', 'เข้าถึงงานซ่อมได้ทุกประเภท'),
    ('repair.settings', 'Repair', 'ตั้งค่า threshold และ approval rules ของระบบซ่อม')
ON CONFLICT (permission_key) DO NOTHING;

-- ให้ Admin เข้าได้ทุก permission ของ repair
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE LOWER(r.role_name) = 'admin'
  AND p.permission_key IN (
      'repair.computer.request',
      'repair.medical.request',
      'repair.general.request',
      'repair.computer.tech',
      'repair.medical.tech',
      'repair.other.tech',
      'repair.supply',
      'repair.approve',
      'repair.all',
      'repair.settings'
  )
ON CONFLICT DO NOTHING;

COMMIT;

-- =================================================================
-- ตรวจสอบหลังรัน:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name LIKE 'repair_%'
--   ORDER BY table_name;
--
--   SELECT * FROM public.repair_settings ORDER BY setting_key;
--   SELECT * FROM public.permissions WHERE permission_key LIKE 'repair.%' ORDER BY permission_key;
-- =================================================================
