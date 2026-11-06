# ระบบแจ้งซ่อม (repair-app)

สร้างจากแม่แบบ `example-app` ตาม design spec v1.3 (Phase 1 + SLA + audit log)

## ติดตั้งและรัน

```bash
pnpm install                          # ที่ root ของโปรเจกต์ (ลิงก์ workspace ให้แอปใหม่)
pnpm --filter backend db:setup        # ถ้ายังไม่เคยรัน
pnpm --filter backend db:setup:repair # สร้างตาราง repair_* + permission + ครุภัณฑ์ตัวอย่าง
pnpm backend                          # API ที่ http://localhost:3002
pnpm --filter repair-app dev          # http://localhost:5181/repair/
```

การเชื่อมต่อฐานข้อมูลอ่านจาก `apps/backend/.env` (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`)

บัญชีทดสอบ: `admin / admin123`, `staff / staff123`, `tech / tech123`

## หน้าจอ

| เส้นทาง | หน้าที่ |
|---|---|
| `/repairs` | รายการงานซ่อม + สถานะ SLA |
| `/repairs/new` | แจ้งซ่อม + เตือนเมื่อเครื่องมีใบค้าง |
| `/repairs/:id` | Timeline, เปลี่ยนสถานะ, ผู้ติดตาม, สถานะในทะเบียนครุภัณฑ์ |
| `/assets/:id` | ประวัติการซ่อมรายเครื่อง |
| `/audit` | ประวัติการแก้ไข (สิทธิ์ `repair.audit.view`) |
| `/settings` | ค่าตั้งระบบและ SLA (แก้ได้เมื่อมี `repair.settings`) |

## Backend

- `apps/backend/sql/repair.sql` — schema
- `apps/backend/src/modules/repair.ts` — API
- `apps/backend/src/modules/repair_sla.ts` — ตรวจงานค้างทุก `sla_scan_interval_min` นาที (สั่งรันทันที: `POST /api/repair-sla/run`)
- `apps/backend/src/modules/repair_common.ts` — สิทธิ์, transition, transaction + audit context

## ยังไม่ทำในรอบนี้

- แนบไฟล์ (ต้องเพิ่ม `multer`, `sharp`, `file-type` ฝั่ง backend)
- อะไหล่ / ซ่อมภายนอก / ใบเสนอราคา / ขั้นอนุมัติ (Phase 2)
- API ยังเชื่อ header `x-person-id` จากหน้าเว็บ เหมือนแอปอื่นในโปรเจกต์ฝึกงาน ต้องเปลี่ยนเป็นตรวจ token ก่อนขึ้นระบบจริง
