import { Express, Request, Response } from 'express';
import { PoolClient } from 'pg';
import {
  AssetType,
  CurrentUser,
  HttpError,
  STATUS_LABEL,
  TECH_HELD_STATUSES,
  can,
  getCurrentUser,
  mtpPool,
  notify,
  personsWithPermission,
  sendError,
  techPermission,
  withTx,
} from './repair_common';

// ===========================================================================
// ทีมซ่อม: โอนงาน / ผู้ร่วมซ่อม / ความคืบหน้า / ข้อมูลประกอบฟอร์ม
//   POST   /api/repairs/:id/transfer               ช่างผู้รับผิดชอบโอนงาน (body: to_person_id, reason)
//   POST   /api/repairs/:id/co-technicians         เพิ่มผู้ร่วมซ่อม (body: person_id)
//   DELETE /api/repairs/:id/co-technicians/:personId
//   POST   /api/repairs/:id/progress               บันทึกความคืบหน้า (เฉพาะสถานะกำลังดำเนินงาน)
//   GET    /api/repair-technicians?asset_type=     รายชื่อช่างที่มีสิทธิ์ตามประเภทงาน
// ===========================================================================

export async function listCoTechnicians(ticketId: number) {
  try {
    const { rows } = await mtpPool.query(
      `SELECT c.person_id, c.added_at, p.firstname || ' ' || COALESCE(p.lastname, '') AS person_name
         FROM repair_co_technicians c JOIN person p ON p.person_id = c.person_id
        WHERE c.ticket_id = $1 ORDER BY c.added_at`,
      [ticketId]
    );
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return [];
    throw err;
  }
}

export async function listProgressLogs(ticketId: number) {
  try {
    const { rows } = await mtpPool.query(
      `SELECT l.log_id, l.note, l.created_at, l.person_id,
              p.firstname || ' ' || COALESCE(p.lastname, '') AS person_name
         FROM repair_progress_logs l JOIN person p ON p.person_id = l.person_id
        WHERE l.ticket_id = $1 ORDER BY l.created_at, l.log_id`,
      [ticketId]
    );
    return rows;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return [];
    throw err;
  }
}

async function requireCurrent(req: Request): Promise<CurrentUser> {
  const u = await getCurrentUser(req);
  if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');
  return u;
}

async function lockTicket(client: PoolClient, ticketId: number) {
  const { rows } = await client.query('SELECT * FROM repair_tickets WHERE ticket_id = $1 FOR UPDATE', [ticketId]);
  if (rows.length === 0) throw new HttpError(404, 'ไม่พบใบซ่อม');
  return rows[0];
}

async function personName(client: PoolClient | typeof mtpPool, personId: number | null) {
  if (!personId) return '-';
  const { rows } = await client.query(
    `SELECT firstname || ' ' || COALESCE(lastname, '') AS name FROM person WHERE person_id = $1`,
    [personId]
  );
  return (rows[0]?.name as string | undefined)?.trim() || `#${personId}`;
}

async function isTeamMember(client: PoolClient, ticket: { ticket_id: number; assignee_id: number | null }, u: CurrentUser) {
  if (ticket.assignee_id === u.person_id || can(u, 'repair.all')) return true;
  const { rows } = await client.query(
    'SELECT 1 FROM repair_co_technicians WHERE ticket_id = $1 AND person_id = $2',
    [ticket.ticket_id, u.person_id]
  );
  return rows.length > 0;
}

async function recordEvent(
  client: PoolClient,
  ticket: { ticket_id: number; status: string },
  personId: number,
  remark: string,
  metadata: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO repair_status_history (ticket_id, from_status, to_status, remark, metadata, changed_by)
     VALUES ($1, $2, $2, $3, $4, $5)`,
    [ticket.ticket_id, ticket.status, remark, metadata, personId]
  );
}

export function repairTeamRoutes(app: Express) {
  // ---------------------------------------------------------------- ช่างที่รับโอนงานได้
  app.get('/api/repair-technicians', async (req: Request, res: Response) => {
    try {
      await requireCurrent(req);
      const type = String(req.query.asset_type || '').toUpperCase() as AssetType;
      if (!['COMPUTER', 'MEDICAL', 'GENERAL'].includes(type)) throw new HttpError(400, 'ประเภทงานไม่ถูกต้อง');
      const ids = await personsWithPermission(mtpPool, techPermission(type));
      const { rows } = await mtpPool.query(
        `SELECT person_id, firstname || ' ' || COALESCE(lastname, '') AS name
           FROM person WHERE person_id = ANY($1::int[]) ORDER BY firstname, lastname`,
        [ids]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดรายชื่อช่างไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- โอนงาน
  app.post('/api/repairs/:id/transfer', async (req: Request, res: Response) => {
    try {
      const u = await requireCurrent(req);
      const toId = Number(req.body.to_person_id);
      const reason = String(req.body.reason || '').trim();
      if (!toId) throw new HttpError(400, 'กรุณาเลือกช่างที่รับโอนงาน');

      await withTx({ userId: u.person_id, reason: reason || 'โอนงาน' }, async (client) => {
        const t = await lockTicket(client, Number(req.params.id));
        if (!TECH_HELD_STATUSES.includes(t.status)) {
          throw new HttpError(400, `โอนงานไม่ได้ในสถานะ "${STATUS_LABEL[t.status]}"`);
        }
        if (t.assignee_id !== u.person_id && !can(u, 'repair.all')) {
          throw new HttpError(403, 'เฉพาะช่างผู้รับผิดชอบปัจจุบันเท่านั้นที่โอนงานได้');
        }
        if (toId === t.assignee_id) throw new HttpError(400, 'ช่างคนนี้เป็นผู้รับผิดชอบอยู่แล้ว');
        const eligible = await personsWithPermission(client, techPermission(t.asset_type as AssetType));
        if (!eligible.includes(toId)) throw new HttpError(400, 'ช่างที่เลือกไม่มีสิทธิ์รับงานประเภทนี้');

        const fromName = await personName(client, t.assignee_id);
        const toName = await personName(client, toId);

        await client.query(
          `UPDATE repair_assignments SET unassigned_at = NOW(), reason = $2 WHERE ticket_id = $1 AND unassigned_at IS NULL`,
          [t.ticket_id, reason || null]
        );
        await client.query(
          `INSERT INTO repair_assignments (ticket_id, assignee_id, assigned_by, reason) VALUES ($1, $2, $3, $4)`,
          [t.ticket_id, toId, u.person_id, reason || null]
        );
        await client.query('DELETE FROM repair_co_technicians WHERE ticket_id = $1 AND person_id = $2', [t.ticket_id, toId]);
        await client.query(
          'UPDATE repair_tickets SET assignee_id = $1, modify_by = $2, modify_date = NOW() WHERE ticket_id = $3',
          [toId, u.person_id, t.ticket_id]
        );
        await recordEvent(client, t, u.person_id,
          `โอนงานจาก ${fromName} ให้ ${toName}${reason ? ` · ${reason}` : ''}`,
          { event: 'TRANSFER', from_person_id: t.assignee_id, to_person_id: toId });

        const watchers = await client.query('SELECT person_id FROM repair_ticket_watchers WHERE ticket_id = $1', [t.ticket_id]);
        const recipients = [t.requester_id, toId, ...watchers.rows.map((r) => r.person_id as number)]
          .filter((id) => id !== u.person_id);
        await notify(client, recipients, {
          ticket_id: t.ticket_id,
          type: 'TRANSFERRED',
          title: `โอนงาน ${t.ticket_no} ให้ ${toName}`,
          message: reason || t.title,
        });
      });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'โอนงานไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- ผู้ร่วมซ่อม
  app.post('/api/repairs/:id/co-technicians', async (req: Request, res: Response) => {
    try {
      const u = await requireCurrent(req);
      const personId = Number(req.body.person_id);
      if (!personId) throw new HttpError(400, 'กรุณาเลือกช่างที่ต้องการเพิ่มเป็นผู้ร่วมซ่อม');

      await withTx({ userId: u.person_id }, async (client) => {
        const t = await lockTicket(client, Number(req.params.id));
        if (!TECH_HELD_STATUSES.includes(t.status)) {
          throw new HttpError(400, `เพิ่มผู้ร่วมซ่อมไม่ได้ในสถานะ "${STATUS_LABEL[t.status]}"`);
        }
        if (t.assignee_id !== u.person_id && !can(u, 'repair.all')) {
          throw new HttpError(403, 'เฉพาะช่างผู้รับผิดชอบเพิ่มผู้ร่วมซ่อมได้');
        }
        if (personId === t.assignee_id) throw new HttpError(400, 'ช่างผู้รับผิดชอบหลักไม่ต้องเพิ่มเป็นผู้ร่วมซ่อม');
        const eligible = await personsWithPermission(client, techPermission(t.asset_type as AssetType));
        if (!eligible.includes(personId)) throw new HttpError(400, 'ช่างที่เลือกไม่มีสิทธิ์ซ่อมงานประเภทนี้');

        const ins = await client.query(
          `INSERT INTO repair_co_technicians (ticket_id, person_id, added_by) VALUES ($1, $2, $3)
           ON CONFLICT (ticket_id, person_id) DO NOTHING`,
          [t.ticket_id, personId, u.person_id]
        );
        if (ins.rowCount === 0) throw new HttpError(400, 'ช่างคนนี้เป็นผู้ร่วมซ่อมอยู่แล้ว');

        const name = await personName(client, personId);
        await recordEvent(client, t, u.person_id, `เพิ่มผู้ร่วมซ่อม: ${name}`, { event: 'CO_TECH_ADDED', person_id: personId });
        await notify(client, [personId], {
          ticket_id: t.ticket_id,
          type: 'CO_TECH_ADDED',
          title: `คุณถูกเพิ่มเป็นผู้ร่วมซ่อม ${t.ticket_no}`,
          message: t.title,
        });
      });
      res.status(201).json({ success: true });
    } catch (err) {
      sendError(res, err, 'เพิ่มผู้ร่วมซ่อมไม่สำเร็จ');
    }
  });

  app.delete('/api/repairs/:id/co-technicians/:personId', async (req: Request, res: Response) => {
    try {
      const u = await requireCurrent(req);
      const personId = Number(req.params.personId);

      await withTx({ userId: u.person_id }, async (client) => {
        const t = await lockTicket(client, Number(req.params.id));
        const self = personId === u.person_id;
        if (!self && t.assignee_id !== u.person_id && !can(u, 'repair.all')) {
          throw new HttpError(403, 'เฉพาะช่างผู้รับผิดชอบนำผู้ร่วมซ่อมออกได้');
        }
        const del = await client.query('DELETE FROM repair_co_technicians WHERE ticket_id = $1 AND person_id = $2', [t.ticket_id, personId]);
        if (del.rowCount === 0) throw new HttpError(404, 'ไม่พบผู้ร่วมซ่อมคนนี้');

        const name = await personName(client, personId);
        await recordEvent(client, t, u.person_id, `นำผู้ร่วมซ่อมออก: ${name}`, { event: 'CO_TECH_REMOVED', person_id: personId });
      });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'นำผู้ร่วมซ่อมออกไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- ความคืบหน้าระหว่างซ่อม
  app.post('/api/repairs/:id/progress', async (req: Request, res: Response) => {
    try {
      const u = await requireCurrent(req);
      const note = String(req.body.note || '').trim();
      if (!note) throw new HttpError(400, 'กรุณาระบุรายละเอียดความคืบหน้า');

      const row = await withTx({ userId: u.person_id }, async (client) => {
        const t = await lockTicket(client, Number(req.params.id));
        if (t.status !== 'IN_PROGRESS') {
          throw new HttpError(400, 'บันทึกความคืบหน้าได้เฉพาะตอนสถานะ "กำลังดำเนินงาน"');
        }
        if (!(await isTeamMember(client, t, u))) {
          throw new HttpError(403, 'เฉพาะช่างผู้รับผิดชอบหรือผู้ร่วมซ่อมบันทึกความคืบหน้าได้');
        }
        const ins = await client.query(
          `INSERT INTO repair_progress_logs (ticket_id, person_id, note) VALUES ($1, $2, $3)
           RETURNING log_id, note, created_at, person_id`,
          [t.ticket_id, u.person_id, note]
        );
        return ins.rows[0];
      });
      res.status(201).json({ success: true, data: row });
    } catch (err) {
      sendError(res, err, 'บันทึกความคืบหน้าไม่สำเร็จ');
    }
  });
}
