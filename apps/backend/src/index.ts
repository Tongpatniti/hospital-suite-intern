import express from 'express';
import cors from 'cors';
import db from './db';
import { authRoutes } from './auth';
import { trainingItemsRoutes } from './modules/training_items';

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    const r = await db.mtpPool.query('SELECT current_database() AS database, NOW() AS now');
    res.json({ status: 'ok', database: r.rows[0].database, now: r.rows[0].now });
  } catch (err) {
    console.error('Health check error', err);
    res.status(500).json({ status: 'error', message: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ' });
  }
});

// ---------------------------------------------------------------------------
// ลงทะเบียน route ของทุกโมดูลที่นี่
// เพิ่มโมดูลใหม่ = สร้างไฟล์ใน src/modules/ แล้ว import + เรียกใช้ด้านล่าง
// ---------------------------------------------------------------------------
authRoutes(app);
trainingItemsRoutes(app);

// 404
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'API not found.' });
});

// error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Backend (intern starter) listening on http://localhost:${PORT}`);
  db.mtpPool.query('SELECT 1').catch((err) => {
    console.error('Cannot connect to database — ตรวจ .env แล้วรัน pnpm db:setup', err.message);
  });
});
