# Hospital Suite — Intern Starter

Monorepo สำหรับนักศึกษาฝึกงาน โครงสร้างเดียวกับ `hospital-suite-monorepo` เพื่อให้
**แอปที่สร้างเสร็จแล้วสามารถยกไปประกอบกับระบบจริงได้เลย** โดยแก้เพียง path/พอร์ตไม่กี่จุด

- Frontend: React 19 + Vite + TypeScript + Tailwind + `@repo/ui` (shadcn-style)
- Backend: Express 5 + PostgreSQL (`pg`) + bcrypt
- Workspace: pnpm + Turborepo
- ฐานข้อมูล: `mtp_training` (แยกจากข้อมูลจริง)

---

## 1. โครงสร้างโปรเจกต์

```
hospital-suite-intern/
├─ apps/
│  ├─ backend/          Express API (auth, สิทธิ์, SSO, โมดูลตัวอย่าง)
│  │  ├─ src/
│  │  │  ├─ db.ts       pool กลาง (ใช้ db.mtpPool เท่านั้น)
│  │  │  ├─ auth.ts     login / change-password / SSO
│  │  │  ├─ index.ts    จุดลงทะเบียน route ของทุกโมดูล
│  │  │  └─ modules/
│  │  │     └─ training_items.ts   ← ตัวอย่างโมดูล CRUD
│  │  ├─ sql/init.sql   schema ของฐานฝึก
│  │  └─ scripts/setup-db.cjs      สร้าง DB + seed
│  ├─ hub/              หน้า portal เลือกแอป + SSO
│  └─ example-app/      ← แม่แบบแอปสำหรับนักศึกษา (คัดลอกไปทำอันใหม่)
│     └─ src/
│        ├─ App.tsx               routes + protected route
│        ├─ contexts/AuthContext.tsx  login + SSO + hasPermission
│        ├─ layouts/MainLayout.tsx    sidebar + back to hub
│        ├─ pages/Login.tsx
│        ├─ pages/TrainingItems.tsx   ตัวอย่าง CRUD + แบ่งหน้า + สิทธิ์
│        └─ lib/format.ts             วันที่ พ.ศ. / เงิน
└─ packages/
   ├─ ui/               คอมโพเนนต์กลาง (@repo/ui/button, card, dialog, table, ...)
   └─ api-client/       axios instance กลาง (@repo/api-client)
```

**พอร์ต**

| ส่วน | พอร์ต |
|---|---|
| backend | 3002 |
| hub | 5179 |
| example-app | 5180 |

> ทำไมไม่ใช้ 3001/5176/5177 เหมือนระบบจริง? เพื่อให้รันคู่กับ `hospital-suite-monorepo`
> ได้พร้อมกัน ไม่ชนพอร์ต (ตอนย้ายเข้า repo จริงค่อยแก้เป็น 3001)

---

## 2. เริ่มใช้งานครั้งแรก

ต้องมี Node.js 20+ และ pnpm 10+

```bash
cd D:\hospital-suite-intern
pnpm install
```

ตั้งค่า `.env` ของ backend:

```bash
copy apps\backend\.env.example apps\backend\.env
# แก้ DB_USER / DB_PASSWORD / DB_HOST ให้ตรงเครื่องคุณ
```

สร้างฐานข้อมูลฝึก + ข้อมูลตัวอย่าง:

```bash
pnpm db:setup
```

รันทั้งระบบ:

```bash
pnpm dev          # backend + hub + example-app พร้อมกัน
# หรือแยก: pnpm backend / pnpm hub / pnpm example
```

เปิด `http://localhost:5179/hub/`

**บัญชีทดสอบ**

| user | password | สิทธิ์ |
|---|---|---|
| `admin` | `admin123` | `all`, `training.login`, `training.view`, `training.edit` |
| `staff` | `staff123` | `training.login`, `training.view` (ดูได้อย่างเดียว) |

---

## 3. สร้างโมดูลใหม่ (ขั้นตอนมาตรฐาน)

> ทุกอย่างยึดจาก `example-app` + `training_items` เป็นแม่แบบ

### 3.1 Frontend — คัดลอกแอป

1. คัดลอก `apps/example-app` → `apps/<ชื่อโมดูล>` (เช่น `apps/medical-supplies`)
2. แก้ใน `apps/<ชื่อโมดูล>/`
   - `package.json` → `"name": "<ชื่อโมดูล>"`
   - `vite.config.ts` → `base: '/<ชื่อโมดูล>/'`, `server.port` ใหม่ (5181, 5182, …)
   - `src/App.tsx` → `basename="/<ชื่อโมดูล>"`
   - `src/contexts/AuthContext.tsx` → เปลี่ยน `STORAGE_KEY` / `TOKEN_KEY`
   - `src/layouts/MainLayout.tsx` → เมนู, ชื่อระบบ, URL กลับ hub
   - `src/pages/` → หน้าใหม่ของคุณ
3. ลงทะเบียนแอปที่ `apps/hub/src/App.tsx` (`apps` array)
   ```ts
   {
     name: 'Medical Supplies',
     url: import.meta.env.DEV
       ? `http://${window.location.hostname}:5181/medical-supplies/`
       : '/medical-supplies/',
     icon: 'BookOpen',
     description: '...',
     color: 'bg-emerald-500',
     permission: 'supplies.login',   // ← ต้องตรงกับ backend
   }
   ```

### 3.2 Backend — เพิ่ม route

1. สร้าง `apps/backend/src/modules/<ชื่อโมดูล>.ts`
   ```ts
   import { Express, Request, Response } from 'express';
   import db from '../db';

   const mtpPool = db.mtpPool;   // ← ใช้ pool กลางเท่านั้น ห้ามสร้าง Pool ใหม่

   export function suppliesRoutes(app: Express) {
     app.get('/api/supplies', async (_req: Request, res: Response) => { /* ... */ });
   }
   ```
2. ลงทะเบียนใน `apps/backend/src/index.ts`
   ```ts
   import { suppliesRoutes } from './modules/supplies';
   // ...
   suppliesRoutes(app);
   ```
3. ถ้าแอปต้องมีสิทธิ์ก่อนเข้า (ผ่าน Hub) เพิ่มใน `apps/backend/src/auth.ts`
   ```ts
   const APP_PERMISSION = {
     example: 'training.login',
     supplies: 'supplies.login',   // ← เพิ่ม
   };
   ```

### 3.3 ฐานข้อมูล + สิทธิ์

1. เพิ่มตารางใน `apps/backend/sql/init.sql` (ใช้ `CREATE TABLE IF NOT EXISTS`)
2. เพิ่ม permission ใหม่ใน `apps/backend/scripts/setup-db.cjs` (`PERMISSIONS`)
   แล้วรัน `pnpm db:setup` ซ้ำ (ปลอดภัย เป็น idempotent)
3. กำหนดว่า role ไหนได้สิทธิ์อะไรใน `setup-db.cjs` (`adminKeys` / `staffKeys`)

### 3.4 Checklist ก่อนส่งงาน

- [ ] `pnpm typecheck` ผ่าน
- [ ] `pnpm --filter <ชื่อโมดูล> build` ผ่าน
- [ ] login ด้วย `admin` และ `staff` แล้วสิทธิ์ต่างกันจริง
- [ ] เข้าจาก Hub ได้ (SSO ไม่ต้อง login ซ้ำ)
- [ ] ค้นหา/แบ่งหน้า/เพิ่ม/แก้ไข/ลบ ทำงานครบ
- [ ] ข้อความวันที่/ตัวเลขแสดงแบบไทย (พ.ศ.)

---

## 4. นำแอปไปประกอบกับ `hospital-suite-monorepo`

1. คัดลอกโฟลเดอร์ `apps/<ชื่อโมดูล>` ไปวางใน `hospital-suite-monorepo/apps/`
2. ปรับค่าที่เกี่ยวกับ environment:
   - `vite.config.ts` → proxy `/api` ชี้ `http://localhost:3001`
   - `server.port` ให้ไม่ชนแอปเดิม (ดูรายการพอร์ตใน repo จริง)
   - `base` / `basename` ให้ตรงกับ path ที่ hub ใช้
3. คัดลอกไฟล์ backend `src/modules/<ชื่อโมดูล>.ts` ไปที่
   `hospital-suite-monorepo/apps/backend/src/modules/`
   (ถ้า repo จริงยังไม่มีโฟลเดอร์ `modules/` ให้วางที่ `src/` แล้วปรับ import)
4. ลงทะเบียน route ใน `apps/backend/src/index.ts` ของ repo จริง
5. เพิ่มการ์ดใน `apps/hub/src/App.tsx` ของ repo จริง (ใช้ URL production ตามรูปแบบเดิม)
6. เพิ่ม permission ในฐานข้อมูลจริง (ตาราง `permissions` + `role_permissions`)
   และถ้าใช้ SSO ให้เพิ่มใน `APP_PERMISSION` ของ `apps/backend/src/sso.ts`
7. รัน `npx tsc -b` ใน `apps/backend`, `apps/<ชื่อโมดูล>` และ `apps/hub` ก่อน commit

> **ข้อควรระวัง:** อย่าแก้ `packages/ui` หรือ `packages/api-client` ในโปรเจกต์ฝึก
> ถ้าจำเป็นต้องเพิ่มคอมโพเนนต์กลาง ให้แจ้งพี่เลี้ยงก่อน เพื่อไม่ให้เวอร์ชันแตกจากระบบจริง

---

## 5. กติกาการเขียนโค้ด (เหมือนระบบจริง)

- ใช้ `db.mtpPool` จาก `src/db.ts` เท่านั้น — ห้าม hardcode connection string
- ตอบ API เป็นรูปแบบ `{ success, data, message? }` และใช้ `success: false` เมื่อ error
- วันที่ใน DB ใช้ `TIMESTAMPTZ` และ pool ตั้ง `timezone=Asia/Bangkok` แล้ว
  ฝั่งหน้าจอใช้ `fmtDateTimeTH()` (พ.ศ.)
- ไฟล์ข้อความ/ภาษาไทยต้องเป็น **UTF-8**
- คอมโพเนนต์ UI ใช้ `@repo/ui/...` ไม่ copy โค้ด shadcn ซ้ำในแอป
- ทุก endpoint ที่แก้ข้อมูลควรตรวจสิทธิ์ (`hasPermission('xxx.edit')`) ฝั่งหน้าจอ
  และตรวจซ้ำฝั่งเซิร์ฟเวอร์เมื่อทำได้

---

## 6. คำสั่งที่ใช้บ่อย

```bash
pnpm dev                 # รันทุกแอป
pnpm typecheck           # ตรวจ TypeScript ทุกแอป
pnpm build               # build ทุกแอป
pnpm db:setup            # สร้าง/อัปเดต DB ฝึก + seed
pnpm --filter backend dev
pnpm --filter example-app dev
```

## 7. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `SASL: ... password must be a string` | ยังไม่ได้ตั้ง `DB_PASSWORD` ใน `apps/backend/.env` |
| `ECONNREFUSED` ตอน `db:setup` | PostgreSQL ไม่ได้เปิด หรือ host/port ผิด |
| `permission denied to create database` | user ใน `.env` ต้องมีสิทธิ์ CREATEDB (หรือให้ผู้ดูแลสร้าง DB ให้) |
| หน้าเว้นขาวหลัง build | `base` ใน `vite.config.ts` ไม่ตรงกับ path ที่เปิด |
| เข้าแอปจาก Hub แล้วเด้ง login | SSO exchange ไม่ผ่าน — เช็ก `APP_PERMISSION` กับสิทธิ์ของ role |
