-- =================================================================
-- Repair Base Tables for hospital-suite-intern
-- ฐานข้อมูล: mtp_training
--
-- ใช้สร้าง "ตารางเดิม" ที่ระบบแจ้งซ่อมต้องอ้างอิง:
--   organizations, acquisition_methods, fund_types, brands,
--   equipment_types, equipment_categories, assets,
--   asset_images, asset_transfers
-- และเพิ่มคอลัมน์ที่จำเป็นใน departments
--
-- รันหลัง init.sql / pnpm db:setup แล้วเท่านั้น
-- วิธีรัน:
--   psql -d mtp_training -f apps/backend/sql/repair_base_tables.sql
--
-- ไฟล์นี้ safe to re-run:
--   CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + ON CONFLICT
-- =================================================================

BEGIN;

-- -----------------------------------------------------------------
-- 1. เพิ่มคอลัมน์ที่ระบบ asset/repair ต้องใช้ใน departments
-- -----------------------------------------------------------------
ALTER TABLE public.departments
    ADD COLUMN IF NOT EXISTS code VARCHAR(10),
    ADD COLUMN IF NOT EXISTS department_type VARCHAR(50) NOT NULL DEFAULT 'clinical',
    ADD COLUMN IF NOT EXISTS description VARCHAR(255),
    ADD COLUMN IF NOT EXISTS description_en VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS head_person_id INTEGER REFERENCES public.person(person_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.departments.head_person_id
    IS 'หัวหน้าแผนก ใช้ resolve ผู้อนุมัติขั้น department_head ของระบบซ่อม';

CREATE INDEX IF NOT EXISTS idx_departments_code
    ON public.departments (code);

-- -----------------------------------------------------------------
-- 2. คู่ค้า / ร้านซ่อม (ใช้ organizations.type = vendor)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
    org_id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    tax_id VARCHAR(20),
    branch_code VARCHAR(10) DEFAULT '00000',
    branch_name VARCHAR(255),
    email VARCHAR(100),
    fax VARCHAR(50),
    website VARCHAR(255),
    contact_person VARCHAR(255),
    contact_phone VARCHAR(50),
    house_no VARCHAR(50),
    village VARCHAR(100),
    moo VARCHAR(20),
    soi VARCHAR(100),
    street VARCHAR(100),
    subdistrict VARCHAR(100),
    district VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Thailand',
    is_active BOOLEAN DEFAULT TRUE,
    type VARCHAR(50) DEFAULT 'organization',
    notes TEXT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    modify_date TIMESTAMP WITH TIME ZONE,
    create_by INTEGER REFERENCES public.person(person_id),
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.organizations
    IS 'คู่ค้า/หน่วยงานภายนอก ใช้ type = vendor สำหรับร้านซ่อม';

CREATE INDEX IF NOT EXISTS idx_organizations_type
    ON public.organizations (type, is_active);

-- -----------------------------------------------------------------
-- 3. Master ประกอบทรัพย์สิน
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acquisition_methods (
    acquisition_method_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    description VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.acquisition_methods
    IS 'วิธีการได้มาของทรัพย์สิน เช่น จัดซื้อ รับโอน รับบริจาค';

CREATE TABLE IF NOT EXISTS public.fund_types (
    fund_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    description VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.fund_types
    IS 'ประเภทเงินที่ใช้จัดซื้อ/ซ่อม';

CREATE TABLE IF NOT EXISTS public.brands (
    brand_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    description VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.brands
    IS 'ยี่ห้อ/แบรนด์ของครุภัณฑ์';

CREATE TABLE IF NOT EXISTS public.equipment_types (
    equipment_type_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    description VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.equipment_types
    IS 'ประเภทอุปกรณ์: 1=MEDICAL, 2=COMPUTER, 3=GENERAL';

CREATE TABLE IF NOT EXISTS public.equipment_categories (
    equipment_category_id SERIAL PRIMARY KEY,
    equipment_type_id INTEGER NOT NULL REFERENCES public.equipment_types(equipment_type_id),
    parent_category_id INTEGER REFERENCES public.equipment_categories(equipment_category_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    description VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id),
    CONSTRAINT chk_equipment_categories_no_self_parent
        CHECK (parent_category_id IS NULL OR parent_category_id <> equipment_category_id)
);

COMMENT ON TABLE public.equipment_categories
    IS 'หมวดหมู่ของอุปกรณ์ แยกตาม equipment_type';

CREATE INDEX IF NOT EXISTS idx_equipment_categories_parent
    ON public.equipment_categories (parent_category_id);

-- -----------------------------------------------------------------
-- 4. ครุภัณฑ์
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assets (
    asset_id SERIAL PRIMARY KEY,
    asset_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    equipment_type_id INTEGER REFERENCES public.equipment_types(equipment_type_id),
    equipment_category_id INTEGER REFERENCES public.equipment_categories(equipment_category_id),
    serial_number VARCHAR(50),
    asset_number VARCHAR(50),
    calibration_number VARCHAR(50),
    brand_id INTEGER REFERENCES public.brands(brand_id),
    model VARCHAR(200),
    vendor_id INTEGER REFERENCES public.organizations(org_id),
    department_id INTEGER REFERENCES public.departments(department_id),
    custodian_id INTEGER REFERENCES public.person(person_id),
    notes TEXT,
    purchase_date DATE,
    inspection_date DATE,
    warranty_start_date DATE,
    warranty_expiration_date DATE,
    months_guaranteed INTEGER,
    purchase_price NUMERIC(12, 2),
    status VARCHAR(20) DEFAULT 'Active',
    has_calibration BOOLEAN NOT NULL DEFAULT FALSE,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'basic'
        CHECK (risk_level IN ('high', 'medium', 'basic')),
    reference_doc_no VARCHAR(100),
    acquisition_method_id INTEGER REFERENCES public.acquisition_methods(acquisition_method_id),
    fund_type_id INTEGER REFERENCES public.fund_types(fund_type_id),
    create_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    create_by INTEGER REFERENCES public.person(person_id),
    modify_date TIMESTAMP WITH TIME ZONE,
    modify_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.assets
    IS 'ทะเบียนครุภัณฑ์/ทรัพย์สิน ใช้เป็น source of truth ของระบบซ่อม';
COMMENT ON COLUMN public.assets.vendor_id
    IS 'FK ไปยัง organizations (type = vendor)';
COMMENT ON COLUMN public.assets.has_calibration
    IS 'มีการสอบเทียบหรือไม่';
COMMENT ON COLUMN public.assets.risk_level
    IS 'ระดับความเสี่ยง: high / medium / basic';

CREATE INDEX IF NOT EXISTS idx_assets_type
    ON public.assets (equipment_type_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_department
    ON public.assets (department_id);
CREATE INDEX IF NOT EXISTS idx_assets_custodian
    ON public.assets (custodian_id);

-- -----------------------------------------------------------------
-- 5. รูปภาพและประวัติโอนย้าย
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_images (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES public.assets(asset_id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by INTEGER REFERENCES public.person(person_id)
);

COMMENT ON TABLE public.asset_images
    IS 'รูปภาพประกอบของครุภัณฑ์ (หลายรูปต่อ 1 asset)';

CREATE TABLE IF NOT EXISTS public.asset_transfers (
    transfer_id SERIAL PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES public.assets(asset_id) ON DELETE CASCADE,
    from_department_id INTEGER REFERENCES public.departments(department_id),
    from_custodian_id INTEGER REFERENCES public.person(person_id),
    to_department_id INTEGER REFERENCES public.departments(department_id),
    to_custodian_id INTEGER REFERENCES public.person(person_id),
    transfer_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    created_by INTEGER REFERENCES public.person(person_id),
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.asset_transfers
    IS 'ประวัติการโอนย้ายครุภัณฑ์ระหว่างแผนก/ผู้ดูแล';

CREATE INDEX IF NOT EXISTS idx_asset_images_asset
    ON public.asset_images (asset_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_asset_transfers_asset
    ON public.asset_transfers (asset_id, transfer_date DESC);

-- -----------------------------------------------------------------
-- 6. Seed master ขั้นต่ำสำหรับทดสอบ
-- -----------------------------------------------------------------

-- แผนกที่ใช้ทดสอบ (init.sql ของ intern ไม่มี UNIQUE(name) จึงใช้ WHERE NOT EXISTS)
INSERT INTO public.departments (name, name_en, code, department_type)
SELECT v.name, v.name_en, v.code, v.department_type
FROM (VALUES
    ('ศูนย์คอมพิวเตอร์', 'Computer Center', 'IT', 'support'),
    ('งานพัสดุ', 'Supply Department', 'SUP', 'support'),
    ('งานชีวการแพทย์', 'Biomedical Engineering', 'BME', 'support')
) AS v(name, name_en, code, department_type)
WHERE NOT EXISTS (
    SELECT 1 FROM public.departments d WHERE d.name = v.name
);

UPDATE public.departments SET code = 'MED'
WHERE name = 'เวชกรรม' AND code IS NULL;

-- หัวหน้าแผนกตัวอย่าง (ใช้ person_type = '1' ซึ่งเป็น admin จาก setup-db)
UPDATE public.departments d
SET head_person_id = (
    SELECT p.person_id FROM public.person p
    WHERE p.person_type = '1'
    ORDER BY p.person_id
    LIMIT 1
)
WHERE d.name IN ('ศูนย์คอมพิวเตอร์', 'งานพัสดุ', 'งานชีวการแพทย์')
  AND d.head_person_id IS NULL;

-- ร้านซ่อม/คู่ค้า
INSERT INTO public.organizations (code, name, type, phone)
VALUES
    ('V-001', 'บริษัท เมดิคอล เซอร์วิส จำกัด', 'vendor', '02-000-0001'),
    ('V-002', 'ร้านคอมพิวเตอร์พลัส', 'vendor', '02-000-0002')
ON CONFLICT (code) DO NOTHING;

-- วิธีการได้มา
INSERT INTO public.acquisition_methods (acquisition_method_id, name, name_en) VALUES
    (1, 'จัดซื้อ', 'Purchase'),
    (2, 'รับโอน', 'Transfer In'),
    (3, 'รับบริจาค', 'Donation'),
    (4, 'เช่า', 'Rental'),
    (5, 'อื่น ๆ', 'Others')
ON CONFLICT (acquisition_method_id) DO NOTHING;

-- ประเภทเงิน
INSERT INTO public.fund_types (fund_type_id, name, name_en) VALUES
    (1, 'เงินสด', 'Cash'),
    (2, 'เงินบำรุงโรงพยาบาล', 'Hospital Revenue Fund'),
    (3, 'เงินบริจาค', 'Donation Fund'),
    (4, 'เงินรายได้โรงพยาบาล', 'Hospital Income'),
    (5, 'อื่น ๆ', 'Others')
ON CONFLICT (fund_type_id) DO NOTHING;

-- ประเภทอุปกรณ์: ต้องคง id 1=MEDICAL, 2=COMPUTER, 3=GENERAL
INSERT INTO public.equipment_types (equipment_type_id, name, name_en, description) VALUES
    (1, 'เครื่องมือแพทย์', 'Medical Equipment', 'ครุภัณฑ์ทางการแพทย์'),
    (2, 'คอมพิวเตอร์', 'Computers', 'คอมพิวเตอร์และอุปกรณ์'),
    (3, 'ครุภัณฑ์ทั่วไป', 'General Equipment', 'ครุภัณฑ์สำนักงาน/งานซ่อมทั่วไป')
ON CONFLICT (equipment_type_id) DO UPDATE
SET name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    description = EXCLUDED.description,
    is_active = TRUE;

-- หมวดหมู่ตัวอย่าง
INSERT INTO public.equipment_categories
    (equipment_category_id, equipment_type_id, name, name_en)
VALUES
    (1, 1, 'เครื่องมือแพทย์ทั่วไป', 'General Medical Equipment'),
    (2, 2, 'คอมพิวเตอร์และอุปกรณ์', 'Computer Equipment'),
    (3, 3, 'ครุภัณฑ์สำนักงาน', 'Office Equipment')
ON CONFLICT (equipment_category_id) DO UPDATE
SET equipment_type_id = EXCLUDED.equipment_type_id,
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    is_active = TRUE;

-- ยี่ห้อตัวอย่าง
INSERT INTO public.brands (brand_id, name, name_en) VALUES
    (1, 'Philips', 'Philips'),
    (2, 'Dell', 'Dell'),
    (3, 'HP', 'HP')
ON CONFLICT (brand_id) DO UPDATE
SET name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    is_active = TRUE;

-- ครุภัณฑ์ตัวอย่าง 3 ประเภท
INSERT INTO public.assets (
    asset_id, asset_code, name, name_en,
    equipment_type_id, equipment_category_id, brand_id,
    serial_number, model, vendor_id, department_id, custodian_id,
    purchase_price, status, has_calibration, risk_level,
    acquisition_method_id, fund_type_id
)
SELECT
    1, 'MED-001', 'เครื่องวัดความดันโลหิต', 'Blood Pressure Monitor',
    1, 1, 1,
    'MED-SN-001', 'Philips M3000', o1.org_id, d1.department_id, p.person_id,
    25000.00, 'Active', TRUE, 'medium',
    1, 1
FROM public.organizations o1
CROSS JOIN LATERAL (SELECT department_id FROM public.departments WHERE name = 'เวชกรรม' LIMIT 1) d1
CROSS JOIN LATERAL (SELECT person_id FROM public.person ORDER BY person_id LIMIT 1) p
WHERE o1.code = 'V-001'
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO public.assets (
    asset_id, asset_code, name, name_en,
    equipment_type_id, equipment_category_id, brand_id,
    serial_number, model, vendor_id, department_id, custodian_id,
    purchase_price, status, has_calibration, risk_level,
    acquisition_method_id, fund_type_id
)
SELECT
    2, 'COM-001', 'คอมพิวเตอร์ตั้งโต๊ะ', 'Desktop Computer',
    2, 2, 2,
    'COM-SN-001', 'Dell OptiPlex', o2.org_id, d2.department_id, p.person_id,
    18000.00, 'Active', FALSE, 'basic',
    1, 2
FROM public.organizations o2
CROSS JOIN LATERAL (SELECT department_id FROM public.departments WHERE name = 'ศูนย์คอมพิวเตอร์' LIMIT 1) d2
CROSS JOIN LATERAL (SELECT person_id FROM public.person ORDER BY person_id LIMIT 1) p
WHERE o2.code = 'V-002'
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO public.assets (
    asset_id, asset_code, name, name_en,
    equipment_type_id, equipment_category_id, brand_id,
    serial_number, model, vendor_id, department_id, custodian_id,
    purchase_price, status, has_calibration, risk_level,
    acquisition_method_id, fund_type_id
)
SELECT
    3, 'GEN-001', 'เก้าอี้สำนักงาน', 'Office Chair',
    3, 3, 3,
    'GEN-SN-001', 'HP Office Chair', o2.org_id, d3.department_id, p.person_id,
    3500.00, 'Active', FALSE, 'basic',
    1, 2
FROM public.organizations o2
CROSS JOIN LATERAL (SELECT department_id FROM public.departments WHERE name = 'งานพัสดุ' LIMIT 1) d3
CROSS JOIN LATERAL (SELECT person_id FROM public.person ORDER BY person_id LIMIT 1) p
WHERE o2.code = 'V-002'
ON CONFLICT (asset_id) DO NOTHING;

-- -----------------------------------------------------------------
-- 7. ปรับ sequence หลัง seed แบบกำหนด id เอง
-- -----------------------------------------------------------------
SELECT setval(
    pg_get_serial_sequence('public.organizations', 'org_id'),
    COALESCE((SELECT MAX(org_id) FROM public.organizations), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.acquisition_methods', 'acquisition_method_id'),
    COALESCE((SELECT MAX(acquisition_method_id) FROM public.acquisition_methods), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.fund_types', 'fund_type_id'),
    COALESCE((SELECT MAX(fund_type_id) FROM public.fund_types), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.equipment_types', 'equipment_type_id'),
    COALESCE((SELECT MAX(equipment_type_id) FROM public.equipment_types), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.equipment_categories', 'equipment_category_id'),
    COALESCE((SELECT MAX(equipment_category_id) FROM public.equipment_categories), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.brands', 'brand_id'),
    COALESCE((SELECT MAX(brand_id) FROM public.brands), 1),
    TRUE
);
SELECT setval(
    pg_get_serial_sequence('public.assets', 'asset_id'),
    COALESCE((SELECT MAX(asset_id) FROM public.assets), 1),
    TRUE
);

COMMIT;

-- =================================================================
-- ตรวจสอบหลังรัน:
--   SELECT * FROM public.equipment_types ORDER BY equipment_type_id;
--   SELECT * FROM public.assets ORDER BY asset_id;
--   SELECT * FROM public.organizations WHERE type = 'vendor';
--
-- หลังรันไฟล์นี้แล้ว:
--   คัดลอก migration_repair_system.sql จาก
--   hospital-suite-monorepo/apps/backend/sql/
--   มาที่ hospital-suite-intern/apps/backend/sql/
--   แล้วรัน:
--   psql -d mtp_training -f apps/backend/sql/migration_repair_system.sql
-- =================================================================
