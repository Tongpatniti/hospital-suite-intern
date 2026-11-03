/* eslint-disable no-console */
// สร้างฐานข้อมูลสำหรับฝึก + schema + ข้อมูลตัวอย่าง
// วิธีรัน: cd apps/backend && node scripts/setup-db.cjs
// ต้องมีสิทธิ์ CREATEDB (ค่าเริ่มต้นใน .env ใช้ user postgres)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const bcrypt = require('bcrypt');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const cfg = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
};
const targetDb = process.env.DB_DATABASE || 'mtp_training';
const adminDb = process.env.DB_ADMIN_DATABASE || 'postgres';

const missing = ['DB_USER', 'DB_PASSWORD', 'DB_HOST'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`ไม่พบ ${missing.join(', ')} ใน apps/backend/.env`);
  process.exit(1);
}

const PERMISSIONS = [
  ['all', 'system', 'สิทธิ์ทั้งหมด'],
  ['training.login', 'training', 'เข้าใช้งานโมดูลฝึกงาน'],
  ['training.view', 'training', 'ดูรายการ'],
  ['training.edit', 'training', 'เพิ่ม/แก้ไข/ลบรายการ'],
];

const ITEMS = [
  ['TR-001', 'ตรวจสุขภาพทั่วไป', 'ตรวจร่างกาย', 500],
  ['TR-002', 'ตรวจเลือด CBC', 'ห้องปฏิบัติการ', 350],
  ['TR-003', 'เอกซเรย์ทรวงอก', 'รังสีวิทยา', 600],
  ['TR-004', 'คลื่นหัวใจ EKG', 'ตรวจพิเศษ', 800],
  ['TR-005', 'อัลตราซาวด์ช่องท้อง', 'รังสีวิทยา', 1200],
  ['TR-006', 'ฉีดวัคซีนไข้หวัดใหญ่', 'วัคซีน', 450],
  ['TR-007', 'ทำแผล', 'หัตถการ', 200],
  ['TR-008', 'ให้สารน้ำทางหลอดเลือด', 'หัตถการ', 300],
];

async function ensureDatabase() {
  const admin = new Client({ ...cfg, database: adminDb });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
  if (exists.rows.length === 0) {
    await admin.query(`CREATE DATABASE "${targetDb}"`);
    console.log(`สร้างฐานข้อมูล ${targetDb} แล้ว`);
  } else {
    console.log(`ฐานข้อมูล ${targetDb} มีอยู่แล้ว`);
  }
  await admin.end();
}

async function main() {
  await ensureDatabase();

  const client = new Client({ ...cfg, database: targetDb });
  await client.connect();
  console.log(`เชื่อมต่อ ${targetDb} สำเร็จ`);

  const schema = fs.readFileSync(path.resolve(__dirname, '..', 'sql', 'init.sql'), 'utf8');
  await client.query(schema);
  console.log('สร้างตารางเรียบร้อย');

  await client.query(
    `INSERT INTO departments (name, name_en) VALUES ('เวชกรรม', 'Internal Medicine')
     ON CONFLICT DO NOTHING`
  );
  const dept = await client.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
  const departmentId = dept.rows[0].department_id;

  // ผู้ใช้ตัวอย่าง 2 คน
  const users = [
    { username: 'admin', password: 'admin123', firstname: 'ผู้ดูแล', lastname: 'ระบบ', personType: '1', role: 'admin' },
    { username: 'staff', password: 'staff123', firstname: 'เจ้าหน้าที่', lastname: 'ทดสอบ', personType: '2', role: 'staff' },
  ];

  for (const u of users) {
    const existing = await client.query('SELECT login_id FROM login WHERE username = $1', [u.username]);
    let loginId;
    if (existing.rows.length > 0) {
      loginId = existing.rows[0].login_id;
    } else {
      const person = await client.query(
        `INSERT INTO person (firstname, lastname, person_type, department_id)
         VALUES ($1, $2, $3, $4) RETURNING person_id`,
        [u.firstname, u.lastname, u.personType, departmentId]
      );
      const hash = await bcrypt.hash(u.password, 10);
      const login = await client.query(
        `INSERT INTO login (person_id, username, password, is_active)
         VALUES ($1, $2, $3, TRUE) RETURNING login_id`,
        [person.rows[0].person_id, u.username, hash]
      );
      loginId = login.rows[0].login_id;
    }

    await client.query(
      `INSERT INTO roles (role_name) VALUES ($1) ON CONFLICT (role_name) DO NOTHING`,
      [u.role]
    );
    const role = await client.query('SELECT role_id FROM roles WHERE role_name = $1', [u.role]);
    await client.query(
      `INSERT INTO user_roles (login_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [loginId, role.rows[0].role_id]
    );
  }

  for (const [key, moduleName, description] of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (permission_key, module_name, description)
       VALUES ($1, $2, $3) ON CONFLICT (permission_key) DO NOTHING`,
      [key, moduleName, description]
    );
  }

  const adminRole = await client.query(`SELECT role_id FROM roles WHERE role_name = 'admin'`);
  const staffRole = await client.query(`SELECT role_id FROM roles WHERE role_name = 'staff'`);
  const allPerms = await client.query(`SELECT permission_id, permission_key FROM permissions`);

  const adminKeys = ['all', 'training.login', 'training.view', 'training.edit'];
  const staffKeys = ['training.login', 'training.view'];

  for (const p of allPerms.rows) {
    if (adminKeys.includes(p.permission_key)) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [adminRole.rows[0].role_id, p.permission_id]
      );
    }
    if (staffKeys.includes(p.permission_key)) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [staffRole.rows[0].role_id, p.permission_id]
      );
    }
  }

  for (const [code, name, category, price] of ITEMS) {
    await client.query(
      `INSERT INTO training_items (code, name, category, price, is_active, create_by)
       VALUES ($1, $2, $3, $4, TRUE, 'seed')
       ON CONFLICT (code) DO NOTHING`,
      [code, name, category, price]
    );
  }

  await client.end();
  console.log('\nเสร็จสิ้น! บัญชีทดสอบ:');
  console.log('  admin / admin123  (เห็นทุกเมนู + เพิ่ม/แก้ไขได้)');
  console.log('  staff / staff123  (ดูได้อย่างเดียว)');
  console.log(`\nฐานข้อมูล: ${targetDb} @ ${cfg.host}:${cfg.port}`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
