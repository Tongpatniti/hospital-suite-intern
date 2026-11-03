import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import db from './db';

const mtpPool = db.mtpPool;
const saltRounds = 10;
const HUB_SESSION_HOURS = 12;
const APP_TOKEN_SECONDS = 60;

// permission ที่ต้องมีก่อนเข้าแอปผ่าน Hub (เพิ่มแอปใหม่ที่นี่)
const APP_PERMISSION: Record<string, string | null> = {
  example: 'training.login',
};

type LoginRow = {
  login_id: number;
  person_id: number;
  username: string;
  password: string;
  is_active: boolean;
};

async function buildProfile(loginInfo: LoginRow) {
  const personResult = await mtpPool.query(
    `SELECT p.*, d.name AS department_name, d.name_en AS department_name_en
     FROM person p
     LEFT JOIN departments d ON p.department_id = d.department_id
     WHERE p.person_id = $1`,
    [loginInfo.person_id]
  );
  if (personResult.rows.length === 0) throw new Error('person not found');
  const person = personResult.rows[0];

  const permResult = await mtpPool.query(
    `SELECT DISTINCT p.permission_key
     FROM permissions p
     JOIN role_permissions rp ON p.permission_id = rp.permission_id
     JOIN user_roles ur ON rp.role_id = ur.role_id
     WHERE ur.login_id = $1`,
    [loginInfo.login_id]
  );

  return {
    person_id: person.person_id,
    firstname: person.firstname,
    lastname: person.lastname,
    firstname_en: person.firstname_en,
    lastname_en: person.lastname_en,
    username: loginInfo.username,
    person_type: person.person_type,
    role: person.person_type === '1' ? 'admin' : 'user',
    permissions: [...new Set(permResult.rows.map((r) => r.permission_key as string))],
    department_id: person.department_id || null,
    department_name: person.department_name || null,
    department_name_en: person.department_name_en || null,
  };
}

async function createSession(loginId: number, personId: number, kind: 'hub' | 'app') {
  const token = crypto.randomBytes(32).toString('hex');
  const interval = kind === 'hub' ? `make_interval(hours => ${HUB_SESSION_HOURS})` : `make_interval(secs => ${APP_TOKEN_SECONDS})`;
  await mtpPool.query(
    `INSERT INTO sso_sessions (token, login_id, person_id, kind, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ${interval})`,
    [token, loginId, personId, kind]
  );
  return token;
}

export function authRoutes(app: Express) {
  // เข้าสู่ระบบ — คืนโปรไฟล์ + hub SSO token (รูปแบบเดียวกับ hospital-suite-monorepo)
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    let { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    username = String(username).trim().toLowerCase();
    try {
      const loginResult = await mtpPool.query('SELECT * FROM login WHERE LOWER(username) = $1', [username]);
      if (loginResult.rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
      }
      const loginInfo = loginResult.rows[0] as LoginRow;
      const passwordMatch = await bcrypt.compare(password, loginInfo.password);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
      }
      if (!loginInfo.is_active) {
        return res.status(403).json({ success: false, message: 'User account is disabled.' });
      }

      await mtpPool.query('UPDATE login SET last_login_date = NOW() WHERE login_id = $1', [loginInfo.login_id]);
      const profile = await buildProfile(loginInfo);
      const ssoToken = await createSession(loginInfo.login_id, loginInfo.person_id, 'hub');
      return res.json({ success: true, data: { ...profile, sso_token: ssoToken } });
    } catch (err) {
      console.error('Login error', err);
      return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  });

  // เปลี่ยนรหัสผ่าน
  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    const { username, currentPassword, newPassword } = req.body;
    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }
    try {
      const loginResult = await mtpPool.query('SELECT * FROM login WHERE LOWER(username) = $1', [String(username).toLowerCase().trim()]);
      if (loginResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานในระบบ' });
      }
      const loginInfo = loginResult.rows[0] as LoginRow;
      const isMatch = await bcrypt.compare(currentPassword, loginInfo.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
      }
      const hashed = await bcrypt.hash(newPassword, saltRounds);
      await mtpPool.query('UPDATE login SET password = $1, modify_date = NOW() WHERE login_id = $2', [hashed, loginInfo.login_id]);
      res.json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
    } catch (err) {
      console.error('Change password error', err);
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
  });

  // ตรวจรหัสผ่านซ้ำก่อนอนุมัติ (ใช้ในฟีเจอร์อนุมัติ)
  app.post('/api/auth/verify-approval-auth', async (req: Request, res: Response) => {
    let { username, password, requiredPermission } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อผู้ใช้งานและรหัสผ่าน' });
    }
    username = String(username).trim().toLowerCase();
    try {
      const loginRes = await mtpPool.query('SELECT * FROM login WHERE LOWER(username) = $1', [username]);
      if (loginRes.rows.length === 0) {
        return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
      }
      const loginInfo = loginRes.rows[0] as LoginRow;
      if (!loginInfo.is_active) {
        return res.status(403).json({ success: false, message: 'บัญชีผู้ใช้นี้ถูกระงับการใช้งาน' });
      }
      const passwordMatch = await bcrypt.compare(password, loginInfo.password);
      if (!passwordMatch) {
        return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
      }
      if (requiredPermission) {
        const permRes = await mtpPool.query(
          `SELECT 1 FROM permissions p
           JOIN role_permissions rp ON p.permission_id = rp.permission_id
           JOIN user_roles ur ON rp.role_id = ur.role_id
           WHERE ur.login_id = $1 AND p.permission_key = $2`,
          [loginInfo.login_id, requiredPermission]
        );
        if (permRes.rows.length === 0) {
          return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดำเนินการนี้' });
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Verify approval auth error', err);
      res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    }
  });

  // Hub ขอ token อายุสั้นก่อนพาไปยังแอปลูก
  app.post('/api/auth/sso/issue', async (req: Request, res: Response) => {
    const { sso_token } = req.body;
    if (!sso_token) return res.status(400).json({ success: false, message: 'sso_token is required.' });
    try {
      const result = await mtpPool.query(`SELECT * FROM sso_sessions WHERE token = $1 AND kind = 'hub'`, [sso_token]);
      if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid SSO session.' });
      const session = result.rows[0];
      if (new Date(session.expires_at) <= new Date()) {
        return res.status(401).json({ success: false, message: 'SSO session expired. Please login again.' });
      }
      const appToken = await createSession(session.login_id, session.person_id, 'app');
      return res.json({ success: true, sso_token: appToken });
    } catch (err) {
      console.error('SSO issue error', err);
      return res.status(500).json({ success: false, message: 'Failed to issue SSO token.' });
    }
  });

  // แอปลูกแลก token เป็นโปรไฟล์ผู้ใช้ (ไม่ต้อง login ซ้ำ)
  app.post('/api/auth/sso/exchange', async (req: Request, res: Response) => {
    const { sso_token } = req.body;
    if (!sso_token) return res.status(400).json({ success: false, message: 'sso_token is required.' });
    try {
      const result = await mtpPool.query(`SELECT * FROM sso_sessions WHERE token = $1 AND kind = 'app'`, [sso_token]);
      if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid SSO token.' });
      const session = result.rows[0];
      if (session.used_at) return res.status(401).json({ success: false, message: 'SSO token already used.' });
      if (new Date(session.expires_at) <= new Date()) {
        return res.status(401).json({ success: false, message: 'SSO token expired.' });
      }

      const loginRes = await mtpPool.query('SELECT * FROM login WHERE login_id = $1', [session.login_id]);
      if (loginRes.rows.length === 0) return res.status(401).json({ success: false, message: 'User not found.' });
      const loginInfo = loginRes.rows[0] as LoginRow;
      if (!loginInfo.is_active) return res.status(403).json({ success: false, message: 'User account is disabled.' });

      await mtpPool.query('UPDATE sso_sessions SET used_at = NOW() WHERE token = $1', [sso_token]);
      const profile = await buildProfile(loginInfo);

      const appKey = String(req.body.app || '').toLowerCase();
      const required = APP_PERMISSION[appKey] ?? null;
      if (required) {
        const allowed = profile.permissions.includes('all') || profile.permissions.includes(required);
        if (!allowed) {
          return res.status(403).json({ success: false, message: 'คุณไม่มีสิทธิ์เข้าใช้งานแอปพลิเคชันนี้' });
        }
      }

      return res.json({ success: true, data: profile });
    } catch (err) {
      console.error('SSO exchange error', err);
      return res.status(500).json({ success: false, message: 'Failed to exchange SSO token.' });
    }
  });
}
