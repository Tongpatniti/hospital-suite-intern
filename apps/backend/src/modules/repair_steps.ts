import { Express, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { HttpError, can, getCurrentUser, mtpPool, sendError, techPermission, withTx, type AssetType } from './repair_common';

// ===========================================================================
// ข้อมูลประจำขั้นของงานซ่อม
//   WAIT_PART      ช่างกรอกรายการอะไหล่ที่ต้องการ (body.parts[])
//   WAIT_EXTERNAL  ช่างส่งเรื่องซ่อมภายนอก (body.external: reason?, suggested_vendor, is_warranty)
//   EXT_SENT       พัสดุส่งร้าน (body.external: vendor_name, sent_date)
//   EXT_RECEIVED   พัสดุรับเครื่องคืน (body.external: return_date, actual_cost, invoice_no)
//
//   PUT  /api/repairs/:id/parts/:partId   พัสดุใส่ราคาจริง (บังคับเหตุผลเมื่อแก้ราคาที่เคยใส่แล้ว)
//   POST /api/repairs/:id/parts           ช่างเพิ่มรายการระหว่างรอพัสดุ
// ===========================================================================

interface PartInput {
  part_name?: string;
  part_no?: string;
  qty?: number | string;
  unit?: string;
  estimated_unit_price?: number | string | null;
  note?: string;
  attachment_ids?: unknown;
}

function cleanParts(raw: unknown): PartInput[] {
  if (!Array.isArray(raw)) return [];
  return (raw as PartInput[])
    .map((p) => ({ ...p, part_name: String(p.part_name || '').trim() }))
    .filter((p) => p.part_name);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

async function insertParts(client: PoolClient, ticketId: number, personId: number, parts: PartInput[]) {
  for (const p of parts) {
    const qty = num(p.qty ?? 1);
    const price = num(p.estimated_unit_price);
    if (qty === null || Number.isNaN(qty) || qty <= 0) throw new HttpError(400, `จำนวนของ "${p.part_name}" ไม่ถูกต้อง`);
    if (Number.isNaN(price)) throw new HttpError(400, `ราคาประมาณของ "${p.part_name}" ไม่ถูกต้อง`);
    const ins = await client.query(
      `INSERT INTO repair_parts (ticket_id, part_name, part_no, qty, unit, estimated_unit_price, note, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING part_id`,
      [ticketId, String(p.part_name).slice(0, 255), p.part_no || null, qty, p.unit || null, price, p.note || null, personId]
    );

    // รูปของรายการนี้ (อัปโหลดไว้ก่อนแบบ PART ที่ยังไม่ผูก) — บังคับอย่างน้อย 1 รูปต่อรายการ
    const ids = Array.isArray(p.attachment_ids)
      ? (p.attachment_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const linked = ids.length
      ? await client.query(
          `UPDATE repair_attachments SET reference_id = $1
            WHERE ticket_id = $2 AND uploaded_by = $3 AND attachment_id = ANY($4)
              AND reference_type = 'PART' AND reference_id IS NULL AND deleted_at IS NULL AND file_kind = 'IMAGE'
            RETURNING attachment_id`,
          [ins.rows[0].part_id, ticketId, personId, ids]
        )
      : { rows: [] };
    if (linked.rows.length === 0) throw new HttpError(400, `กรุณาแนบรูปของ "${p.part_name}" อย่างน้อย 1 รูป`);
  }
}

/** วันที่บังคับกรอก รูปแบบ YYYY-MM-DD และไม่เป็นวันในอนาคต (ตามเวลาไทยของฐานข้อมูล) */
async function checkDate(client: PoolClient, v: unknown, label: string): Promise<string> {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, `กรุณาระบุ${label}`);
  const { rows } = await client.query(`SELECT $1::date > CURRENT_DATE AS future`, [s]);
  if (rows[0].future) throw new HttpError(400, `${label}ต้องไม่เป็นวันในอนาคต`);
  return s;
}

async function latestExternal(client: PoolClient, ticketId: number) {
  const { rows } = await client.query(
    `SELECT * FROM repair_externals WHERE ticket_id = $1 ORDER BY external_id DESC LIMIT 1 FOR UPDATE`,
    [ticketId]
  );
  if (rows.length === 0) throw new HttpError(400, 'ไม่พบข้อมูลการส่งซ่อมภายนอกของใบนี้');
  return rows[0];
}

/** เรียกภายใน transaction เปลี่ยนสถานะ; คืน metadata เพิ่มเติมสำหรับ history */
export async function applyStepData(
  client: PoolClient,
  t: { ticket_id: number; status: string },
  toStatus: string,
  body: { parts?: unknown; external?: Record<string, unknown>; remark?: string },
  personId: number
): Promise<Record<string, unknown>> {
  const ext = body.external || {};

  if (toStatus === 'WAIT_PART') {
    const parts = cleanParts(body.parts);
    if (parts.length === 0) throw new HttpError(400, 'กรุณากรอกรายการอะไหล่ที่ต้องการอย่างน้อย 1 รายการ');
    await insertParts(client, t.ticket_id, personId, parts);
    return { parts_count: parts.length };
  }

  if (toStatus === 'PART_PURCHASING') {
    await client.query(`UPDATE repair_parts SET status = 'PURCHASING' WHERE ticket_id = $1 AND status = 'REQUESTED'`, [t.ticket_id]);
  }
  if (toStatus === 'PART_ARRIVED') {
    await client.query(`UPDATE repair_parts SET status = 'ARRIVED' WHERE ticket_id = $1 AND status IN ('REQUESTED', 'PURCHASING')`, [t.ticket_id]);
  }
  if (toStatus === 'IN_PROGRESS' && t.status === 'PART_ARRIVED') {
    await client.query(`UPDATE repair_parts SET status = 'ISSUED' WHERE ticket_id = $1 AND status = 'ARRIVED'`, [t.ticket_id]);
  }

  if (toStatus === 'WAIT_EXTERNAL') {
    await client.query(
      `INSERT INTO repair_externals (ticket_id, is_warranty, reason, suggested_vendor, requested_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [t.ticket_id, ext.is_warranty === true, String(body.remark || '').trim() || null,
       String(ext.suggested_vendor || '').trim() || null, personId]
    );
    return { is_warranty: ext.is_warranty === true };
  }

  if (toStatus === 'EXT_SENT') {
    const vendor = String(ext.vendor_name || '').trim();
    if (!vendor) throw new HttpError(400, 'กรุณาระบุร้านที่ส่งซ่อม');
    const sent = await checkDate(client, ext.sent_date, 'วันที่ส่ง');
    const e = await latestExternal(client, t.ticket_id);
    await client.query(
      `UPDATE repair_externals SET vendor_name = $1, sent_date = $2::date, sent_by = $3, status = 'SENT'
        WHERE external_id = $4`,
      [vendor.slice(0, 255), sent, personId, e.external_id]
    );
    return { vendor_name: vendor };
  }

  if (toStatus === 'EXT_RECEIVED') {
    const cost = num(ext.actual_cost);
    if (Number.isNaN(cost)) throw new HttpError(400, 'ค่าซ่อมไม่ถูกต้อง');
    const ret = await checkDate(client, ext.return_date, 'วันที่รับเครื่องคืน');
    const e = await latestExternal(client, t.ticket_id);
    if (e.sent_date && ret < String(e.sent_date instanceof Date ? e.sent_date.toISOString().slice(0, 10) : e.sent_date).slice(0, 10)) {
      throw new HttpError(400, 'วันที่รับเครื่องคืนต้องไม่ก่อนวันที่ส่ง');
    }
    await client.query(
      `UPDATE repair_externals SET return_date = $1::date, actual_cost = $2, invoice_no = $3,
              received_by = $4, status = 'RETURNED'
        WHERE external_id = $5`,
      [ret, cost, String(ext.invoice_no || '').trim() || null, personId, e.external_id]
    );
    return cost !== null ? { actual_cost: cost } : {};
  }

  return {};
}

export async function listParts(ticketId: number) {
  try {
    const { rows } = await mtpPool.query(
      `SELECT p.*, p.qty::float AS qty, p.estimated_unit_price::float AS estimated_unit_price,
              p.actual_unit_price::float AS actual_unit_price,
              rq.firstname || ' ' || COALESCE(rq.lastname, '') AS requested_by_name
         FROM repair_parts p LEFT JOIN person rq ON rq.person_id = p.requested_by
        WHERE p.ticket_id = $1 ORDER BY p.part_id`,
      [ticketId]
    );
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return [];
    throw err;
  }
}

export async function listExternals(ticketId: number) {
  try {
    const { rows } = await mtpPool.query(
      `SELECT e.*, e.actual_cost::float AS actual_cost,
              rq.firstname || ' ' || COALESCE(rq.lastname, '') AS requested_by_name
         FROM repair_externals e LEFT JOIN person rq ON rq.person_id = e.requested_by
        WHERE e.ticket_id = $1 ORDER BY e.external_id`,
      [ticketId]
    );
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return [];
    throw err;
  }
}

const PART_EDITABLE_STATUS = ['WAIT_PART', 'PART_APPROVAL', 'PART_PURCHASING', 'PART_ARRIVED'];

export function repairStepRoutes(app: Express) {
  // ช่างเพิ่มรายการอะไหล่ระหว่างรอพัสดุ
  app.post('/api/repairs/:id/parts', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      const t = await mtpPool.query('SELECT ticket_id, status, asset_type FROM repair_tickets WHERE ticket_id = $1', [req.params.id]);
      if (t.rows.length === 0) throw new HttpError(404, 'ไม่พบใบซ่อม');
      if (!can(u, techPermission(t.rows[0].asset_type as AssetType))) throw new HttpError(403, 'เฉพาะช่างที่เพิ่มรายการอะไหล่ได้');
      if (!['WAIT_PART', 'PART_APPROVAL'].includes(t.rows[0].status)) throw new HttpError(400, 'เพิ่มรายการได้เฉพาะตอนรอพัสดุรับเรื่อง/อนุมัติ');
      const parts = cleanParts(req.body.parts);
      if (parts.length === 0) throw new HttpError(400, 'กรุณากรอกชื่ออะไหล่');
      await withTx({ userId: u.person_id }, (client) => insertParts(client, Number(req.params.id), u.person_id, parts));
      res.status(201).json({ success: true });
    } catch (err) {
      sendError(res, err, 'เพิ่มรายการอะไหล่ไม่สำเร็จ');
    }
  });

  // พัสดุใส่ราคาจริง / หมายเหตุ
  app.put('/api/repairs/:id/parts/:partId', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      if (!can(u, 'repair.supply')) throw new HttpError(403, 'เฉพาะพัสดุที่แก้ราคาอะไหล่ได้');
      const price = num(req.body.actual_unit_price);
      if (Number.isNaN(price)) throw new HttpError(400, 'ราคาไม่ถูกต้อง');
      const reason = String(req.body.reason || '').trim();
      await withTx({ userId: u.person_id, reason: reason || 'บันทึกราคาจริง' }, async (client) => {
        const { rows } = await client.query(
          `SELECT p.*, t.status AS ticket_status FROM repair_parts p JOIN repair_tickets t ON t.ticket_id = p.ticket_id
            WHERE p.part_id = $1 AND p.ticket_id = $2 FOR UPDATE OF p`,
          [req.params.partId, req.params.id]
        );
        const p = rows[0];
        if (!p) throw new HttpError(404, 'ไม่พบรายการอะไหล่');
        if (!PART_EDITABLE_STATUS.includes(p.ticket_status)) throw new HttpError(400, 'ขั้นนี้แก้รายการอะไหล่ไม่ได้แล้ว');
        if (p.actual_unit_price !== null && Number(p.actual_unit_price) !== price && !reason) {
          throw new HttpError(400, 'แก้ราคาที่บันทึกไว้แล้ว ต้องระบุเหตุผล');
        }
        await client.query(
          `UPDATE repair_parts SET actual_unit_price = $1, note = COALESCE($2, note), modify_by = $3, modify_date = NOW()
            WHERE part_id = $4`,
          [price, req.body.note ?? null, u.person_id, p.part_id]
        );
      });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'บันทึกราคาอะไหล่ไม่สำเร็จ');
    }
  });
}
