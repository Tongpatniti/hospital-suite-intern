import { Request } from 'express';
import { PoolClient } from 'pg';
import db from '../db';

export const mtpPool = db.mtpPool;

export type AssetType = 'COMPUTER' | 'MEDICAL' | 'GENERAL';
export const ASSET_TYPES: AssetType[] = ['COMPUTER', 'MEDICAL', 'GENERAL'];

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'แจ้งซ่อม',
  ACCEPTED: 'รับงานซ่อม',
  IN_PROGRESS: 'กำลังดำเนินงาน',
  WAIT_PART: 'สั่งซื้ออะไหล่',
  PART_APPROVAL: 'พัสดุรับเรื่องอะไหล่',
  PO_PENDING: 'รออนุมัติ PO',
  PO_APPROVED: 'ได้รับการอนุมัติ PO แล้ว',
  PART_PURCHASING: 'กำลังจัดซื้ออะไหล่',
  PART_ARRIVED: 'อะไหล่ถึงคลัง',
  WAIT_EXTERNAL: 'แจ้งส่งซ่อมภายนอก',
  EXT_APPROVAL: 'พัสดุรับเรื่อง+รออนุมัติส่งซ่อม',
  EXT_SENT: 'ส่งร้านภายนอกแล้ว',
  EXT_RECEIVED: 'รับอุปกรณ์คืนแล้ว',
  DONE: 'ซ่อมแล้วเสร็จ (รอตรวจรับ)',
  CLOSED: 'ตรวจรับ+ปิดงาน',
  CANCELLED: 'ยกเลิก',
};

export const OPEN_EXCLUDED = ['CLOSED', 'CANCELLED'];

// สถานะที่อยู่ในความดูแลของพัสดุ
export const SUPPLY_STATUSES = [
  'WAIT_PART', 'PART_APPROVAL', 'PO_PENDING', 'PO_APPROVED', 'PART_PURCHASING', 'PART_ARRIVED',
  'WAIT_EXTERNAL', 'EXT_APPROVAL', 'EXT_SENT',
];

// สถานะที่ช่างผู้รับผิดชอบยังถือใบงานอยู่ (ใช้กับการโอนงานและการเพิ่มผู้ร่วมซ่อม)
export const TECH_HELD_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'WAIT_PART', 'WAIT_EXTERNAL', 'PART_ARRIVED', 'EXT_RECEIVED'];

// state diagram หัวข้อ 4 ของ spec
export const TRANSITIONS: Record<string, string[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'WAIT_PART', 'WAIT_EXTERNAL', 'CANCELLED'],
  WAIT_PART: ['PART_APPROVAL', 'CANCELLED'],
  PART_APPROVAL: ['PO_PENDING', 'CANCELLED'],
  PO_PENDING: ['PO_APPROVED', 'PART_APPROVAL'],
  PO_APPROVED: ['PART_PURCHASING'],
  PART_PURCHASING: ['PART_ARRIVED'],
  PART_ARRIVED: ['IN_PROGRESS'],
  WAIT_EXTERNAL: ['EXT_APPROVAL', 'CANCELLED'],
  EXT_APPROVAL: ['EXT_SENT', 'CANCELLED'],
  EXT_SENT: ['EXT_RECEIVED'],
  EXT_RECEIVED: ['IN_PROGRESS'],
  DONE: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

// ผู้รับผิดชอบของแต่ละสถานะ (ใช้ทั้งตรวจสิทธิ์เปลี่ยนสถานะและหาผู้รับแจ้งเตือน SLA)
export type Actor = 'requester' | 'tech' | 'supply' | 'approver' | 'po_approver';
export const STATUS_ACTOR: Record<string, Actor> = {
  NEW: 'tech',
  ACCEPTED: 'tech',
  IN_PROGRESS: 'tech',
  WAIT_PART: 'supply',
  PART_APPROVAL: 'supply',
  PO_PENDING: 'po_approver',
  PO_APPROVED: 'supply',
  PART_PURCHASING: 'supply',
  PART_ARRIVED: 'tech',
  WAIT_EXTERNAL: 'supply',
  EXT_APPROVAL: 'supply',
  EXT_SENT: 'supply',
  EXT_RECEIVED: 'tech',
  DONE: 'requester',
  CLOSED: 'requester',
};

// ใครกดเปลี่ยนไปสถานะปลายทางได้
// ขั้นอนุมัติ (PART_PURCHASING / EXT_SENT) ให้พัสดุกดเองไปก่อน จนกว่าจะมีระบบอนุมัติหลายขั้น
export const TARGET_ACTOR: Record<string, (Actor | 'any')[]> = {
  ACCEPTED: ['tech'],
  IN_PROGRESS: ['tech'],
  WAIT_PART: ['tech'],
  WAIT_EXTERNAL: ['tech'],
  DONE: ['tech'],
  PART_APPROVAL: ['supply'],
  PO_PENDING: ['supply'],
  PO_APPROVED: ['po_approver'],
  PART_PURCHASING: ['supply'],
  PART_ARRIVED: ['supply'],
  EXT_APPROVAL: ['supply'],
  EXT_SENT: ['supply'],
  EXT_RECEIVED: ['supply'],
  CLOSED: ['requester'],
  CANCELLED: ['any'],
};

/** ผู้ที่เปลี่ยนจาก from → to ได้ (ขั้นตรวจรับ: ทั้งช่างและผู้แจ้งส่งกลับซ่อมได้) */
export function targetActors(from: string, to: string): (Actor | 'any')[] {
  if (from === 'DONE' && to === 'IN_PROGRESS') return ['tech', 'requester'];
  if (from === 'PO_PENDING' && to === 'PART_APPROVAL') return ['po_approver'];
  return TARGET_ACTOR[to] || ['any'];
}

export function assetTypeOf(equipmentTypeId: number | null | undefined): AssetType {
  if (equipmentTypeId === 1) return 'MEDICAL';
  if (equipmentTypeId === 2) return 'COMPUTER';
  return 'GENERAL';
}

export function techPermission(t: AssetType) {
  return `repair.${t.toLowerCase()}.tech`;
}

export interface CurrentUser {
  person_id: number;
  permissions: string[];
}

export function can(u: CurrentUser, perm: string) {
  return u.permissions.includes('all') || u.permissions.includes('repair.all') || u.permissions.includes(perm);
}

// ประเภทงานที่ผู้ใช้เห็นได้ (ตามหลักเดียวกับ sidebar ของ asset-management)
export function visibleTypes(u: CurrentUser): AssetType[] {
  if (u.permissions.includes('all') || u.permissions.includes('repair.all')) return ASSET_TYPES;
  // พัสดุรับเรื่องอะไหล่/ส่งซ่อมนอกของทุกประเภท
  if (u.permissions.includes('repair.supply')) return ASSET_TYPES;
  // ผู้อนุมัติ PO ต้องเห็นใบซ่อมทุกประเภทที่รออนุมัติ
  if (u.permissions.includes('repair.po.approve')) return ASSET_TYPES;
  return ASSET_TYPES.filter((t) => {
    const k = t.toLowerCase();
    return u.permissions.includes(`repair.${k}.request`) || u.permissions.includes(`repair.${k}.tech`);
  });
}

/**
 * ผู้ใช้ปัจจุบันจาก header `x-person-id`
 * หมายเหตุ: โปรเจกต์ฝึกงานยังไม่มี session token ฝั่ง API (แอปอื่นส่ง create_by ใน body เช่นกัน)
 * ก่อนขึ้น production ต้องเปลี่ยนเป็นตรวจ token จริง
 */
export async function getCurrentUser(req: Request): Promise<CurrentUser | null> {
  const id = parseInt(String(req.header('x-person-id') || ''), 10);
  if (!id) return null;
  const { rows } = await mtpPool.query(
    `SELECT DISTINCT p.permission_key
       FROM login l
       JOIN user_roles ur ON ur.login_id = l.login_id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE l.person_id = $1 AND l.is_active`,
    [id]
  );
  return { person_id: id, permissions: rows.map((r) => r.permission_key as string) };
}

export async function personsWithPermission(client: PoolClient | typeof mtpPool, perm: string): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT l.person_id
       FROM login l
       JOIN user_roles ur ON ur.login_id = l.login_id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE l.is_active AND p.permission_key = ANY($1)`,
    [[perm, 'all']]
  );
  return rows.map((r) => r.person_id as number);
}

/**
 * Transaction ที่ตั้ง app.user_id / app.reason / app.ip ให้ audit trigger อ่าน (spec 7.11)
 */
export async function withTx<T>(
  ctx: { userId?: number | null; reason?: string | null; ip?: string | null },
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await mtpPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.reason', $2, true), set_config('app.ip', $3, true)`,
      [ctx.userId ? String(ctx.userId) : '', ctx.reason || '', ctx.ip || '']
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSetting(client: PoolClient | typeof mtpPool, key: string, fallback: string) {
  const { rows } = await client.query('SELECT setting_value FROM repair_settings WHERE setting_key = $1', [key]);
  return (rows[0]?.setting_value as string | undefined) ?? fallback;
}

export async function notify(
  client: PoolClient | typeof mtpPool,
  personIds: number[],
  n: { ticket_id: number | null; type: string; title: string; message?: string }
) {
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length === 0) return;
  await client.query(
    `INSERT INTO repair_notifications (person_id, ticket_id, type, title, message)
     SELECT unnest($1::int[]), $2, $3, $4, $5`,
    [ids, n.ticket_id, n.type, n.title, n.message || null]
  );
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

export function sendError(res: import('express').Response, err: unknown, fallback: string) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, ...(err.body || {}) });
  }
  const pg = err as { code?: string; message?: string };
  if (pg && pg.code === 'P0001') {
    return res.status(400).json({ success: false, message: pg.message });
  }
  console.error(fallback, err);
  // 42P01 = ไม่มีตาราง, 42703 = ไม่มีคอลัมน์ → schema ยังไม่ได้อัปเดต
  if (pg && (pg.code === '42P01' || pg.code === '42703')) {
    return res.status(500).json({
      success: false,
      message: `${fallback}: ฐานข้อมูลยังไม่อัปเดต (${pg.message}) — รัน pnpm --filter backend db:setup:repair แล้วรีสตาร์ต backend`,
    });
  }
  return res.status(500).json({ success: false, message: `${fallback}${pg?.message ? ` (${pg.message})` : ''}` });
}
