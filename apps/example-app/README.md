# Example Module (แม่แบบสำหรับนักศึกษา)

แอปนี้เป็น **แม่แบบ** ของทุกโมดูลในโปรเจกต์ฝึกงาน แสดงให้เห็นครบวงจร:

- Login + เก็บ session (`AuthContext`)
- เข้าจาก Hub ด้วย SSO (ไม่ต้อง login ซ้ำ)
- Sidebar + ปุ่มกลับ Hub (`MainLayout`)
- CRUD + ค้นหา + แบ่งหน้า (`TrainingItems`)
- ตรวจสิทธิ์ด้วย `hasPermission('training.edit')`

## เริ่มแก้เป็นโมดูลของตัวเอง

1. คัดลอกโฟลเดอร์นี้เป็น `apps/<ชื่อโมดูล>`
2. แก้ `package.json` (name), `vite.config.ts` (base/port), `App.tsx` (basename)
3. เปลี่ยน `STORAGE_KEY` / `TOKEN_KEY` ใน `contexts/AuthContext.tsx`
4. เพิ่มการ์ดใน `apps/hub/src/App.tsx`
5. สร้าง route ฝั่ง backend ใน `apps/backend/src/` แล้วลงทะเบียนใน `src/index.ts`

อ่านขั้นตอนละเอียดใน `README.md` ที่ root ของโปรเจกต์
