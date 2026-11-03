import { Pool, types } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// โหลด .env จากโฟลเดอร์ apps/backend เสมอ แม้ process จะถูกสั่งรันจากที่อื่น
if (!process.env.DB_PASSWORD) {
  for (const candidate of [path.resolve(__dirname, '..', '.env'), path.resolve(process.cwd(), '.env')]) {
    dotenv.config({ path: candidate, quiet: true });
  }
}

// คอลัมน์ DATE ให้คืนเป็น string 'YYYY-MM-DD' ตรงๆ (กันวันถอยหลัง 1 วันเพราะ timezone)
types.setTypeParser(1082, (v: string) => v);

const POOL_DEFAULTS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  options: '-c timezone=Asia/Bangkok',
} as const;

const mtpPool = new Pool({
  ...POOL_DEFAULTS,
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

mtpPool.on('connect', (client) => {
  console.log('Connected to the mtp database!');
  client.query(`SET TIME ZONE 'Asia/Bangkok'`).catch((err) => {
    console.error('Failed to set timezone on mtp client', err);
  });
});

mtpPool.on('error', (err) => {
  console.error('Unexpected error on idle mtp client', err);
});

const missing = ['DB_USER', 'DB_HOST', 'DB_DATABASE', 'DB_PASSWORD'].filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.warn(`[db] ไม่พบ ${missing.join(', ')} — ตรวจ apps/backend/.env แล้ว restart backend`);
}

export default {
  mtpPool,
};
