/* eslint-disable no-console */
// สร้างตารางระบบแจ้งซ่อม + permission + ข้อมูลตัวอย่าง
// วิธีรัน: pnpm --filter backend db:setup:repair   (ต้องรัน db:setup ก่อน 1 ครั้ง)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const bcrypt = require('bcrypt');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const missing = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_DATABASE'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`ไม่พบ ${missing.join(', ')} ใน apps/backend/.env`);
  process.exit(1);
}

const PERMISSIONS = [
  ['repair.login', 'repair', 'เข้าใช้งานระบบแจ้งซ่อม'],
  ['repair.computer.request', 'repair', 'แจ้งซ่อมคอมพิวเตอร์'],
  ['repair.medical.request', 'repair', 'แจ้งซ่อมเครื่องมือแพทย์'],
  ['repair.general.request', 'repair', 'แจ้งซ่อมทั่วไป'],
  ['repair.computer.tech', 'repair', 'ช่างคอมพิวเตอร์'],
  ['repair.medical.tech', 'repair', 'ช่างเครื่องมือแพทย์'],
  ['repair.general.tech', 'repair', 'ช่างทั่วไป'],
  ['repair.supply', 'repair', 'พัสดุ'],
  ['repair.approve', 'repair', 'ผู้อนุมัติ'],
  ['repair.po.approve', 'repair', 'ผู้อนุมัติ PO'],
  ['repair.audit.view', 'repair', 'ดูประวัติการแก้ไข'],
  ['repair.all', 'repair', 'เห็นงานซ่อมทุกประเภท'],
  ['repair.settings', 'repair', 'ตั้งค่าระบบแจ้งซ่อม'],
];

const ROLES = {
  admin: PERMISSIONS.map((p) => p[0]),
  staff: ['repair.login', 'repair.computer.request', 'repair.medical.request', 'repair.general.request'],
  technician: ['repair.login', 'repair.computer.tech', 'repair.general.tech', 'repair.medical.tech', 'repair.computer.request'],
  supply: ['repair.login', 'repair.supply'],
  tech2: ['repair.login', 'repair.computer.tech', 'repair.general.tech', 'repair.medical.tech'],
  po_approver: ['repair.login', 'repair.po.approve'],
};

// ผู้ใช้ทดสอบเพิ่มเติม [username, password, firstname, lastname, role]
const USERS = [
  ['tech', 'tech123', 'กิตติ', 'ช่างไอที', 'technician'],
  ['tech2', 'tech123', 'สมชาย', 'ช่างซ่อมบำรุง 2', 'tech2'],
  ['supply', 'supply123', 'อรุณี', 'พัสดุ', 'supply'],
  ['poapprover', 'po123', 'วันดี', 'ผู้อนุมัติ PO', 'po_approver'],
];

// [code, name, serial, equipment_type_id, custodian, location, price, purchase_date]
const ASSETS = [
  ['COM-2565-0187', 'คอมพิวเตอร์ตั้งโต๊ะ Dell OptiPlex 7090', '7XK9Q53', 2, 'สมศรี ใจดี', 'ห้องผ่าตัด 3 ชั้น 4', 28500, '2022-03-10'],
  ['COM-2566-0102', 'จอภาพ Dell P2422H', 'CN0P2422', 2, 'สมศรี ใจดี', 'ห้องผ่าตัด 3 ชั้น 4', 6900, '2023-01-20'],
  ['COM-2564-0311', 'เครื่องพิมพ์ HP LaserJet M404', 'PHB8K1203', 2, 'มาลี รักงาน', 'การเงิน ชั้น 1', 9800, '2021-06-01'],
  ['MED-2562-0108', 'Infusion Pump Terumo TE-171', 'TE17100842', 1, 'ปวีณา ศรีสุข', 'ICU ชั้น 5', 38000, '2019-01-15'],
  ['MED-2563-0042', 'เครื่องวัดความดัน Omron HBP-1320', 'HBP13200042', 1, 'วิชัย แสงทอง', 'ER ชั้น 1', 42000, '2020-08-05'],
  ['GEN-2560-0520', 'เครื่องปรับอากาศ Daikin 18000 BTU', 'DK18-0520', 3, 'อนันต์ มีสุข', 'ผู้ป่วยนอก ชั้น 2', 24000, '2017-04-12'],
];

async function main() {
  const client = new Client({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_DATABASE,
  });
  await client.connect();
  console.log(`เชื่อมต่อ ${process.env.DB_DATABASE} สำเร็จ`);

  await client.query(fs.readFileSync(path.resolve(__dirname, '..', 'sql', 'repair.sql'), 'utf8'));
  console.log('สร้างตารางระบบแจ้งซ่อมเรียบร้อย');

  for (const [key, moduleName, description] of PERMISSIONS) {
    await client.query(
      // ใช้ NOT EXISTS แทน ON CONFLICT เพราะบางฐานข้อมูลไม่มี UNIQUE บน permission_key
      `INSERT INTO permissions (permission_key, module_name, description)
       SELECT $1::text, $2::text, $3::text
        WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = $1::text)`,
      [key, moduleName, description]
    );
  }

  for (const [role, keys] of Object.entries(ROLES)) {
    await client.query(
      `INSERT INTO roles (role_name) SELECT $1::text
        WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_name = $1::text)`,
      [role]
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT DISTINCT r.role_id, p.permission_id FROM roles r, permissions p
        WHERE r.role_name = $1 AND p.permission_key = ANY($2)
          AND NOT EXISTS (SELECT 1 FROM role_permissions x
                           WHERE x.role_id = r.role_id AND x.permission_id = p.permission_id)`,
      [role, keys]
    );
  }

  // ผู้ใช้ตัวอย่าง (ช่าง, พัสดุ)
  for (const [username, password, firstname, lastname, role] of USERS) {
    let loginId;
    const existing = await client.query('SELECT login_id FROM login WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      loginId = existing.rows[0].login_id;
    } else {
      const dept = await client.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
      const person = await client.query(
        `INSERT INTO person (firstname, lastname, person_type, department_id) VALUES ($1, $2, '2', $3) RETURNING person_id`,
        [firstname, lastname, dept.rows[0]?.department_id ?? null]
      );
      const hash = await bcrypt.hash(password, 10);
      const login = await client.query(
        `INSERT INTO login (person_id, username, password, is_active) VALUES ($1, $2, $3, TRUE) RETURNING login_id`,
        [person.rows[0].person_id, username, hash]
      );
      loginId = login.rows[0].login_id;
    }
    await client.query(
      `INSERT INTO user_roles (login_id, role_id)
       SELECT $1, role_id FROM roles WHERE role_name = $2
        AND NOT EXISTS (SELECT 1 FROM user_roles WHERE login_id = $1 AND role_id = roles.role_id)
       LIMIT 1`,
      [loginId, role]
    );
  }

  const dept = await client.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
  for (const a of ASSETS) {
    await client.query(
      `INSERT INTO assets (asset_code, name, serial_number, equipment_type_id, custodian_name, location,
                           purchase_price, purchase_date, department_id)
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::int, $5::varchar, $6::varchar, $7::numeric, $8::date, $9::int
        WHERE NOT EXISTS (SELECT 1 FROM assets WHERE asset_code = $1::varchar)`,
      [...a, dept.rows[0]?.department_id ?? null]
    );
  }

  await client.end();
  console.log('\nเสร็จสิ้น! บัญชีทดสอบ:');
  console.log('  admin / admin123  (ทุกสิทธิ์รวมตั้งค่าและดูประวัติการแก้ไข)');
  console.log('  staff / staff123  (แจ้งซ่อมได้)');
  console.log('  tech  / tech123   (ช่างทุกประเภท)');
  console.log('  tech2 / tech123   (ช่างคอมพิวเตอร์ + ทั่วไป + เครื่องมือแพทย์ สำหรับทดสอบโอนงาน)');
  console.log('  supply / supply123 (พัสดุ: รับเรื่องอะไหล่และส่งซ่อมภายนอก)');
  console.log('  poapprover / po123 (ผู้อนุมัติ PO)');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
