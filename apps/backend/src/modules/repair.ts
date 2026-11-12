import { Express, Request, Response } from 'express';
import { PoolClient } from 'pg';
import {
  AssetType,
  ASSET_TYPES,
  CurrentUser,
  HttpError,
  OPEN_EXCLUDED,
  STATUS_LABEL,
  SUPPLY_STATUSES,
  targetActors,
  TRANSITIONS,
  assetTypeOf,
  can,
  getCurrentUser,
  getSetting,
  mtpPool,
  notify,
  personsWithPermission,
  sendError,
  techPermission,
  visibleTypes,
  withTx,
} from './repair_common';
import { linkStatusAttachments, listAttachments } from './repair_attachments';
import { applyStepData, listExternals, listParts, listPurchaseOrders } from './repair_steps';
import { listCoTechnicians, listProgressLogs } from './repair_team';
import { TICKET_COST_SQL } from './repair_history';

// ===========================================================================
// ระบบแจ้งซ่อม (design spec v1.3)
//   ใบซ่อม:     GET/POST /api/repairs, GET /api/repairs/:id, PATCH /api/repairs/:id/status
//   ผู้ติดตาม:   POST /api/repairs/:id/watchers, DELETE /api/repairs/:id/watchers/me
//   ครุภัณฑ์:    GET /api/repair-assets, GET /api/assets/:id/open-repairs, GET /api/assets/:id/repair-history
//   ตั้งค่า:     GET /api/repair-settings, PATCH /api/repair-settings/:key
//   SLA rules:  GET /api/repair-sla-rules, PUT /api/repair-sla-rules/:id
//   Audit:      GET /api/repair-audit-logs
//   แจ้งเตือน:   GET /api/repair-notifications, POST /api/repair-notifications/read
// ทุก request ต้องส่ง header x-person-id (ดู getCurrentUser)
// ===========================================================================

async function requireUser(req: Request): Promise<CurrentUser> {
  const u = await getCurrentUser(req);
  if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');
  if (!can(u, 'repair.login') && visibleTypes(u).length === 0) {
    throw new HttpError(403, 'คุณไม่มีสิทธิ์ใช้งานระบบแจ้งซ่อม');
  }
  return u;
}

function clientIp(req: Request) {
  return (req.header('x-forwarded-for') || req.socket.remoteAddress || '').split(',')[0].trim();
}

async function nextTicketNo(client: PoolClient) {
  const { rows } = await client.query(`SELECT nextval('repair_ticket_no_seq') AS n`);
  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0');
  return `RP-${yy}${String(rows[0].n).padStart(4, '0')}`;
}

async function findOpenTickets(client: PoolClient | typeof mtpPool, assetId: number) {
  const { rows } = await client.query(
    `SELECT t.ticket_id, t.ticket_no, t.status, t.title, t.description, t.created_date,
            p.firstname || ' ' || COALESCE(p.lastname, '') AS requester_name
       FROM repair_tickets t
       JOIN person p ON p.person_id = t.requester_id
      WHERE t.asset_id = $1 AND t.status <> ALL($2)
      ORDER BY t.created_date`,
    [assetId, OPEN_EXCLUDED]
  );
  return rows;
}

function canActAsAny(u: CurrentUser, actors: string[], ticket: { asset_type: AssetType; requester_id: number }) {
  return actors.some((a) => canActAs(u, a, ticket));
}

function canActAs(u: CurrentUser, actor: string, ticket: { asset_type: AssetType; requester_id: number }) {
  if (u.permissions.includes('all') || u.permissions.includes('repair.all')) return true;
  switch (actor) {
    case 'any':
      return true;
    case 'requester':
      return ticket.requester_id === u.person_id;
    case 'tech':
      return u.permissions.includes(techPermission(ticket.asset_type));
    case 'supply':
      return u.permissions.includes('repair.supply');
    case 'approver':
      return u.permissions.includes('repair.approve');
    case 'po_approver':
      return u.permissions.includes('repair.po.approve');
    default:
      return false;
  }
}

/** spec 8.6 — ซิงก์สถานะทะเบียนครุภัณฑ์ภายใน transaction เปลี่ยนสถานะ */
async function syncAssetStatus(
  client: PoolClient,
  ticket: { ticket_id: number; asset_id: number | null; asset_status_before: string | null },
  toStatus: string,
  closeResult: string | null
) {
  if (!ticket.asset_id) return;
  const repairing = await getSetting(client, 'asset_status_repairing', 'REPAIRING');
  const disposal = await getSetting(client, 'asset_status_disposal', 'DISPOSAL');
  const { rows } = await client.query('SELECT status FROM assets WHERE asset_id = $1 FOR UPDATE', [ticket.asset_id]);
  if (rows.length === 0) return;
  const current = rows[0].status as string;

  if (toStatus === 'ACCEPTED' || (toStatus === 'IN_PROGRESS' && ticket.asset_status_before === null)) {
    if (current !== repairing) {
      await client.query('UPDATE repair_tickets SET asset_status_before = $1 WHERE ticket_id = $2', [current, ticket.ticket_id]);
      await client.query('UPDATE assets SET status = $1 WHERE asset_id = $2', [repairing, ticket.asset_id]);
    } else {
      // มีใบอื่นเปิดอยู่แล้ว ใช้สถานะเดิมของใบนั้น
      const prev = await client.query(
        `SELECT asset_status_before FROM repair_tickets
          WHERE asset_id = $1 AND ticket_id <> $2 AND asset_status_before IS NOT NULL
          ORDER BY created_date LIMIT 1`,
        [ticket.asset_id, ticket.ticket_id]
      );
      await client.query('UPDATE repair_tickets SET asset_status_before = $1 WHERE ticket_id = $2', [
        prev.rows[0]?.asset_status_before ?? 'AVAILABLE',
        ticket.ticket_id,
      ]);
    }
    return;
  }

  if (toStatus === 'CLOSED' || toStatus === 'CANCELLED') {
    const others = await client.query(
      `SELECT 1 FROM repair_tickets WHERE asset_id = $1 AND ticket_id <> $2 AND status <> ALL($3) LIMIT 1`,
      [ticket.asset_id, ticket.ticket_id, OPEN_EXCLUDED]
    );
    if (others.rows.length > 0) return;
    if (current !== repairing) return; // ไม่เคยถูกตั้งเป็นอยู่ระหว่างซ่อม (เช่น ยกเลิกตั้งแต่ NEW)
    const next = closeResult === 'UNREPAIRABLE' ? disposal : ticket.asset_status_before || 'AVAILABLE';
    await client.query('UPDATE assets SET status = $1 WHERE asset_id = $2', [next, ticket.asset_id]);
  }
}

async function ticketRecipients(client: PoolClient, ticketId: number, exclude: number) {
  const { rows } = await client.query(
    `SELECT requester_id AS id FROM repair_tickets WHERE ticket_id = $1
     UNION SELECT assignee_id FROM repair_tickets WHERE ticket_id = $1 AND assignee_id IS NOT NULL
     UNION SELECT person_id FROM repair_ticket_watchers WHERE ticket_id = $1`,
    [ticketId]
  );
  return rows.map((r) => r.id as number).filter((id) => id !== exclude);
}

export function repairRoutes(app: Express) {
  // ---------------------------------------------------------------- list
  app.get('/api/repairs', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const types = visibleTypes(u);
      const params: unknown[] = [];
      const where: string[] = [];

      const reqType = String(req.query.asset_type || '').toUpperCase();
      const isTypePage = ASSET_TYPES.includes(reqType as AssetType);
      const typeFilter = isTypePage ? (types.includes(reqType as AssetType) ? [reqType] : []) : types;
      params.push(typeFilter);
      if (isTypePage) {
        where.push(`t.asset_type = ANY($${params.length})`);
      } else {
        params.push(u.person_id);
        where.push(`(t.asset_type = ANY($${params.length - 1}) OR t.requester_id = $${params.length})`);
      }

      const status = String(req.query.status || '');
      if (status === 'open') {
        params.push(OPEN_EXCLUDED);
        where.push(`t.status <> ALL($${params.length})`);
      } else if (status) {
        params.push(status.split(','));
        where.push(`t.status = ANY($${params.length})`);
      }
      if (req.query.mine === '1') {
        params.push(u.person_id);
        where.push(`(t.requester_id = $${params.length} OR t.assignee_id = $${params.length}
                     OR EXISTS (SELECT 1 FROM repair_ticket_watchers w WHERE w.ticket_id = t.ticket_id AND w.person_id = $${params.length}))`);
      }
      const scope = String(req.query.scope || '');
      if (scope === 'my_requests') {
        params.push(u.person_id);
        where.push(`t.requester_id = $${params.length}`);
      } else if (scope === 'my_tasks') {
        params.push(u.person_id);
        where.push(`(t.assignee_id = $${params.length} OR EXISTS (
                     SELECT 1 FROM repair_co_technicians c WHERE c.ticket_id = t.ticket_id AND c.person_id = $${params.length}))`);
      } else if (scope === 'handled') {
        params.push(u.person_id, SUPPLY_STATUSES);
        where.push(`EXISTS (SELECT 1 FROM repair_status_history h WHERE h.ticket_id = t.ticket_id
                     AND h.changed_by = $${params.length - 1} AND h.to_status = ANY($${params.length}))`);
      }
      const q = String(req.query.q || '').trim();
      if (q) {
        params.push(`%${q}%`);
        where.push(`(t.ticket_no ILIKE $${params.length} OR t.title ILIKE $${params.length} OR t.asset_code_snapshot ILIKE $${params.length})`);
      }

      const { rows } = await mtpPool.query(
        `SELECT t.ticket_id, t.ticket_no, t.asset_type, t.asset_id, t.asset_code_snapshot, t.title,
                t.asset_department_snapshot, t.urgency, t.status, t.status_entered_at, t.is_warranty, t.created_date,
                rq.firstname || ' ' || COALESCE(rq.lastname, '') AS requester_name,
                asg.firstname || ' ' || COALESCE(asg.lastname, '') AS assignee_name,
                ROUND((EXTRACT(EPOCH FROM (NOW() - t.status_entered_at)) / 3600)::NUMERIC, 1)::FLOAT AS hours_in_status,
                sla.warn_after_hours::FLOAT AS warn_after_hours
           FROM repair_tickets t
           JOIN person rq ON rq.person_id = t.requester_id
           LEFT JOIN person asg ON asg.person_id = t.assignee_id
           LEFT JOIN LATERAL (
             SELECT r.warn_after_hours FROM repair_sla_rules r
              WHERE r.is_active AND r.status = t.status
                AND (r.urgency IS NULL OR r.urgency = t.urgency)
                AND (r.asset_type IS NULL OR r.asset_type = t.asset_type)
              ORDER BY (r.urgency IS NOT NULL)::INT + (r.asset_type IS NOT NULL)::INT DESC
              LIMIT 1
           ) sla ON TRUE
          WHERE ${where.join(' AND ')}
          ORDER BY ${req.query.view === 'all' ? '' : `(CASE WHEN t.requester_id = ${u.person_id} THEN 0 ELSE 1 END) ASC,`}
                   (t.status = ANY('{CLOSED,CANCELLED}')) ASC,
                   (EXTRACT(EPOCH FROM (NOW() - t.status_entered_at)) / 3600) / NULLIF(sla.warn_after_hours, 0) DESC NULLS LAST,
                   t.created_date DESC
          LIMIT 300`,
        params
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดรายการใบซ่อมไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- detail
  app.get('/api/repairs/:id', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const { rows } = await mtpPool.query(
        `SELECT t.*, rq.firstname || ' ' || COALESCE(rq.lastname, '') AS requester_name,
                asg.firstname || ' ' || COALESCE(asg.lastname, '') AS assignee_name,
                a.status AS asset_current_status, d.ticket_no AS duplicate_of_ticket_no,
                dn.firstname || ' ' || COALESCE(dn.lastname, '') AS done_by_name,
                cb.firstname || ' ' || COALESCE(cb.lastname, '') AS closed_by_name
           FROM repair_tickets t
           JOIN person rq ON rq.person_id = t.requester_id
           LEFT JOIN person asg ON asg.person_id = t.assignee_id
           LEFT JOIN assets a ON a.asset_id = t.asset_id
           LEFT JOIN repair_tickets d ON d.ticket_id = t.duplicate_of_ticket_id
            LEFT JOIN person dn ON dn.person_id = t.done_by
            LEFT JOIN person cb ON cb.person_id = t.closed_by
          WHERE t.ticket_id = $1`,
        [req.params.id]
      );
      const ticket = rows[0];
      if (!ticket) throw new HttpError(404, 'ไม่พบใบซ่อม');

      const [history, watchers, alerts, evaluation, prev, attachments, parts, externals, purchaseOrders, coTechs, progress] = await Promise.all([
        mtpPool.query(
          `SELECT h.*, p.firstname || ' ' || COALESCE(p.lastname, '') AS changed_by_name
             FROM repair_status_history h LEFT JOIN person p ON p.person_id = h.changed_by
            WHERE h.ticket_id = $1 ORDER BY h.changed_at DESC, h.history_id DESC`,
          [ticket.ticket_id]
        ),
        mtpPool.query(
          `SELECT w.*, p.firstname || ' ' || COALESCE(p.lastname, '') AS person_name
             FROM repair_ticket_watchers w JOIN person p ON p.person_id = w.person_id
            WHERE w.ticket_id = $1 ORDER BY w.created_at`,
          [ticket.ticket_id]
        ),
        mtpPool.query(`SELECT * FROM repair_sla_alerts WHERE ticket_id = $1 AND level = 1 ORDER BY sent_at DESC`, [ticket.ticket_id]),
        mtpPool.query(`SELECT * FROM repair_evaluations WHERE ticket_id = $1`, [ticket.ticket_id]),
        ticket.asset_id
          ? mtpPool.query(
              `SELECT ticket_id, ticket_no, title, description, created_date, status, close_result
                 FROM repair_tickets WHERE asset_id = $1 AND ticket_id <> $2
                ORDER BY created_date DESC LIMIT 3`,
              [ticket.asset_id, ticket.ticket_id]
            )
          : Promise.resolve({ rows: [] }),
        listAttachments(ticket.ticket_id),
        listParts(ticket.ticket_id),
        listExternals(ticket.ticket_id),
        listPurchaseOrders(ticket.ticket_id),
        listCoTechnicians(ticket.ticket_id),
        listProgressLogs(ticket.ticket_id),
      ]);

      const allowed = (TRANSITIONS[ticket.status] || []).filter((s) =>
        canActAsAny(u, targetActors(ticket.status, s), ticket)
      );

      res.json({
        success: true,
        data: {
          ...ticket,
          history: history.rows,
          watchers: watchers.rows,
          sla_alerts: alerts.rows,
          evaluation: evaluation.rows[0] || null,
          previous_repairs: prev.rows,
          attachments,
          parts,
          externals,
          purchase_orders: purchaseOrders,
          co_technicians: coTechs,
          progress_logs: progress,
          allowed_transitions: allowed.map((s) => ({ code: s, label: STATUS_LABEL[s] })),
          is_watching: watchers.rows.some((w) => w.person_id === u.person_id),
        },
      });
    } catch (err) {
      sendError(res, err, 'โหลดใบซ่อมไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- create (spec 8.1 + 8.7)
  app.post('/api/repairs', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const { asset_id, title, description, urgency, location, duplicate_of_ticket_id, duplicate_reason } = req.body;
      let assetType: AssetType = String(req.body.asset_type || 'GENERAL').toUpperCase() as AssetType;

      const result = await withTx({ userId: u.person_id, ip: clientIp(req) }, async (client) => {
        let asset: Record<string, unknown> | null = null;
        if (asset_id) {
          const a = await client.query(
            `SELECT a.*, d.name AS department_name FROM assets a
               LEFT JOIN departments d ON d.department_id = a.department_id
              WHERE a.asset_id = $1 FOR UPDATE OF a`,
            [asset_id]
          );
          if (a.rows.length === 0) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
          const found = a.rows[0] as Record<string, unknown>;
          asset = found;
          assetType = assetTypeOf(found.equipment_type_id as number);

          const open = await findOpenTickets(client, Number(asset_id));
          if (open.length > 0) {
            const dupOk = duplicate_of_ticket_id && String(duplicate_reason || '').trim()
              && open.some((o) => o.ticket_id === Number(duplicate_of_ticket_id));
            if (!dupOk) {
              throw new HttpError(409, `เครื่องนี้มีใบซ่อมค้างอยู่แล้ว ${open[0].ticket_no}`, {
                code: 'OPEN_TICKET_EXISTS',
                open_tickets: open,
              });
            }
          }
        }
        if (!ASSET_TYPES.includes(assetType)) throw new HttpError(400, 'ประเภทงานไม่ถูกต้อง');
        if (!can(u, `repair.${assetType.toLowerCase()}.request`)) {
          throw new HttpError(403, 'คุณไม่มีสิทธิ์แจ้งซ่อมประเภทนี้');
        }
        const finalTitle = String(title || asset?.name || '').trim();
        if (!finalTitle) throw new HttpError(400, 'กรุณาระบุชื่อสิ่งของที่แจ้งซ่อม');

        const me = await client.query('SELECT department_id FROM person WHERE person_id = $1', [u.person_id]);
        const ticketNo = await nextTicketNo(client);
        const ins = await client.query(
          `INSERT INTO repair_tickets (
             ticket_no, asset_type, asset_id, asset_code_snapshot, asset_name_snapshot, serial_number_snapshot,
             asset_department_snapshot, custodian_name_snapshot, location_snapshot, title, description, urgency,
             requester_id, requester_department_id, asset_department_id, duplicate_of_ticket_id, duplicate_reason,
             create_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$13)
           RETURNING *`,
          [
            ticketNo, assetType, asset_id || null,
            asset?.asset_code ?? null, asset?.name ?? null, asset?.serial_number ?? null,
            asset?.department_name ?? null, asset?.custodian_name ?? null,
            String(location || asset?.location || '') || null,
            finalTitle, description || null, urgency || 'NORMAL',
            u.person_id, me.rows[0]?.department_id ?? null, asset?.department_id ?? null,
            duplicate_of_ticket_id || null, duplicate_of_ticket_id ? String(duplicate_reason).trim() : null,
          ]
        );
        const t = ins.rows[0];
        await client.query(
          `INSERT INTO repair_status_history (ticket_id, from_status, to_status, remark, changed_by, changed_at)
           VALUES ($1, NULL, 'NEW', $2, $3, $4)`,
          [t.ticket_id, description || null, u.person_id, t.status_entered_at]
        );
        const techs = await personsWithPermission(client, techPermission(assetType));
        await notify(client, techs, {
          ticket_id: t.ticket_id,
          type: 'NEW_TICKET',
          title: `ใบแจ้งซ่อมใหม่ ${ticketNo}`,
          message: finalTitle,
        });
        return t;
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      sendError(res, err, 'สร้างใบแจ้งซ่อมไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- change status
  app.patch('/api/repairs/:id/status', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const toStatus = String(req.body.to_status || '');
      const remark = String(req.body.remark || '').trim() || null;
      const closeResult = req.body.close_result ? String(req.body.close_result) : null;

      const result = await withTx({ userId: u.person_id, reason: remark, ip: clientIp(req) }, async (client) => {
        const { rows } = await client.query('SELECT * FROM repair_tickets WHERE ticket_id = $1 FOR UPDATE', [req.params.id]);
        const t = rows[0];
        if (!t) throw new HttpError(404, 'ไม่พบใบซ่อม');
        if (!(TRANSITIONS[t.status] || []).includes(toStatus)) {
          throw new HttpError(400, `เปลี่ยนจาก "${STATUS_LABEL[t.status]}" เป็น "${STATUS_LABEL[toStatus] || toStatus}" ไม่ได้`);
        }
        if (!canActAsAny(u, targetActors(t.status, toStatus), t)) throw new HttpError(403, 'คุณไม่มีสิทธิ์เปลี่ยนสถานะนี้');
        if (toStatus === 'CANCELLED' && !remark) throw new HttpError(400, 'กรุณาระบุเหตุผลการยกเลิก');
        if (toStatus === 'DONE' && !remark) throw new HttpError(400, 'กรุณาระบุรายละเอียดการซ่อม');
        if (toStatus === 'WAIT_EXTERNAL' && !remark) throw new HttpError(400, 'กรุณาระบุอาการ / เหตุผลที่ต้องส่งซ่อมภายนอก');
        if (t.status === 'PO_PENDING' && toStatus === 'PART_APPROVAL' && !remark) throw new HttpError(400, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ PO');
        if (toStatus === 'IN_PROGRESS' && (t.status === 'DONE' || t.status === 'CLOSED') && !remark) {
          throw new HttpError(400, 'กรุณาระบุเหตุผลที่ส่งกลับซ่อม');
        }

        const sets: string[] = ['status = $1', 'status_entered_at = NOW()', 'modify_by = $2', 'modify_date = NOW()'];
        const vals: unknown[] = [toStatus, u.person_id];
        const metadata: Record<string, unknown> = {};

        if (toStatus === 'ACCEPTED') {
          sets.push('accepted_date = NOW()', `assignee_id = $${vals.push(u.person_id)}`);
          await client.query(
            `UPDATE repair_assignments SET unassigned_at = NOW() WHERE ticket_id = $1 AND unassigned_at IS NULL`,
            [t.ticket_id]
          );
          await client.query(
            `INSERT INTO repair_assignments (ticket_id, assignee_id, assigned_by) VALUES ($1, $2, $2)`,
            [t.ticket_id, u.person_id]
          );
          metadata.assignee_id = u.person_id;
        }
        // ผลการซ่อม: ช่างเลือกตอน "ซ่อมเสร็จ" (ผู้แจ้งไม่ต้องเลือกตอนปิดงาน)
        if (toStatus === 'DONE') {
          const cr = closeResult || 'REPAIRED';
          if (!['REPAIRED', 'UNREPAIRABLE', 'NOT_FOUND'].includes(cr)) throw new HttpError(400, 'ผลการซ่อมไม่ถูกต้อง');
          sets.push('done_date = NOW()', `close_result = $${vals.push(cr)}`, `done_by = $${vals.push(u.person_id)}`);
          metadata.close_result = cr;
        }
        if (toStatus === 'CANCELLED') sets.push('cancelled_date = NOW()');
        if (toStatus === 'CLOSED') {
          const score = parseInt(String(req.body.score || ''), 10);
          if (!(score >= 1 && score <= 5)) throw new HttpError(400, 'กรุณาให้คะแนนความพึงพอใจ 1–5 ดาว');
          sets.push('closed_date = NOW()', `close_result = COALESCE(close_result, 'REPAIRED')`, `closed_by = $${vals.push(u.person_id)}`);
          await client.query(
            `INSERT INTO repair_evaluations (ticket_id, score, comment, evaluated_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (ticket_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment,
               evaluated_by = EXCLUDED.evaluated_by, evaluated_at = NOW()`,
            [t.ticket_id, score, req.body.comment || null, u.person_id]
          );
          metadata.score = score;
        }
        if (toStatus === 'IN_PROGRESS' && t.status === 'CLOSED') {
          sets.push('reopen_count = reopen_count + 1', 'closed_date = NULL', 'closed_by = NULL', 'close_result = NULL');
          metadata.event = 'REOPEN';
        }
        if (toStatus === 'IN_PROGRESS' && t.status === 'PART_ARRIVED') metadata.event = 'PART_ISSUED';
        if (toStatus === 'IN_PROGRESS' && t.status === 'EXT_RECEIVED') metadata.event = 'EXT_INSPECTED';
        if (toStatus === 'IN_PROGRESS' && t.status === 'DONE') sets.push('done_date = NULL', 'done_by = NULL', 'close_result = NULL');

        // ข้อมูลประจำขั้น (ฟอร์มอะไหล่ / ส่งซ่อมภายนอก)
        Object.assign(metadata, await applyStepData(client, t, toStatus, req.body, u.person_id));
        if (toStatus === 'WAIT_EXTERNAL') sets.push(`is_warranty = $${vals.push(req.body.external?.is_warranty === true)}`);

        vals.push(t.ticket_id);
        const upd = await client.query(
          `UPDATE repair_tickets SET ${sets.join(', ')} WHERE ticket_id = $${vals.length} RETURNING *`,
          vals
        );
        const hist = await client.query(
          `INSERT INTO repair_status_history (ticket_id, from_status, to_status, remark, metadata, changed_by, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING history_id`,
          [t.ticket_id, t.status, toStatus, remark, Object.keys(metadata).length ? metadata : null, u.person_id,
           upd.rows[0].status_entered_at]
        );

        // ไฟล์ที่อัปโหลดรอไว้สำหรับขั้นนี้ (ไม่บังคับ)
        const ids: number[] = Array.isArray(req.body.attachment_ids)
          ? req.body.attachment_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
          : [];
        await linkStatusAttachments(client, t.ticket_id, u.person_id, hist.rows[0].history_id, ids);

        const reopenFromClosed = toStatus === 'IN_PROGRESS' && t.status === 'CLOSED';
        await syncAssetStatus(
          client,
          { ...t, asset_status_before: reopenFromClosed ? null : t.asset_status_before },
          toStatus,
          upd.rows[0].close_result
        );

        const recipients = await ticketRecipients(client, t.ticket_id, u.person_id);
        // ส่งเรื่องให้พัสดุ
        if (toStatus === 'PO_PENDING') {
          recipients.push(...(await personsWithPermission(client, 'repair.po.approve')).filter((id) => id !== u.person_id));
        }
        if (toStatus === 'WAIT_PART' || toStatus === 'WAIT_EXTERNAL') {
          recipients.push(...(await personsWithPermission(client, 'repair.supply')).filter((id) => id !== u.person_id));
        }
        await notify(client, recipients, {
          ticket_id: t.ticket_id,
          type: 'STATUS_CHANGED',
          title: `${t.ticket_no}: ${STATUS_LABEL[toStatus]}`,
          message: remark || undefined,
        });
        return upd.rows[0];
      });
      res.json({ success: true, data: result });
    } catch (err) {
      sendError(res, err, 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- watchers (spec 6.16)
  app.post('/api/repairs/:id/watchers', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const source = req.body.source === 'DUPLICATE' ? 'DUPLICATE' : 'MANUAL';
      const note = String(req.body.note || '').trim() || null;
      await withTx({ userId: u.person_id }, async (client) => {
        const t = await client.query('SELECT ticket_id, ticket_no, status FROM repair_tickets WHERE ticket_id = $1', [req.params.id]);
        if (t.rows.length === 0) throw new HttpError(404, 'ไม่พบใบซ่อม');
        await client.query(
          `INSERT INTO repair_ticket_watchers (ticket_id, person_id, source, note) VALUES ($1, $2, $3, $4)
           ON CONFLICT (ticket_id, person_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, repair_ticket_watchers.note)`,
          [req.params.id, u.person_id, source, note]
        );
        if (source === 'DUPLICATE') {
          await client.query(
            `INSERT INTO repair_status_history (ticket_id, from_status, to_status, remark, metadata, changed_by)
             VALUES ($1, $2, $2, $3, '{"event":"DUPLICATE_WATCH"}', $4)`,
            [req.params.id, t.rows[0].status, note, u.person_id]
          );
          await notify(client, await ticketRecipients(client, Number(req.params.id), u.person_id), {
            ticket_id: Number(req.params.id),
            type: 'DUPLICATE_WATCH',
            title: `มีผู้แจ้งปัญหาเดียวกันเพิ่ม ${t.rows[0].ticket_no}`,
            message: note || undefined,
          });
        }
      });
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'เพิ่มผู้ติดตามไม่สำเร็จ');
    }
  });

  app.delete('/api/repairs/:id/watchers/me', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      await mtpPool.query('DELETE FROM repair_ticket_watchers WHERE ticket_id = $1 AND person_id = $2', [req.params.id, u.person_id]);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'เลิกติดตามไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- assets
  app.get('/api/repair-assets', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const q = String(req.query.q || '').trim();
      const { rows } = await mtpPool.query(
        `SELECT a.asset_id, a.asset_code, a.name, a.serial_number, a.equipment_type_id, a.location, a.status,
                d.name AS department_name,
                (SELECT t.ticket_no FROM repair_tickets t
                  WHERE t.asset_id = a.asset_id AND t.status <> ALL($2) ORDER BY t.created_date LIMIT 1) AS open_ticket_no
           FROM assets a LEFT JOIN departments d ON d.department_id = a.department_id
          WHERE ($1 = '' OR a.asset_code ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%')
          ORDER BY a.asset_code LIMIT 50`,
        [q, OPEN_EXCLUDED]
      );
      const types = visibleTypes(u);
      res.json({ success: true, data: rows.map((r) => ({ ...r, asset_type: assetTypeOf(r.equipment_type_id) }))
        .filter((r) => types.includes(r.asset_type)) });
    } catch (err) {
      sendError(res, err, 'โหลดครุภัณฑ์ไม่สำเร็จ');
    }
  });

  app.get('/api/assets/:id/open-repairs', async (req: Request, res: Response) => {
    try {
      await requireUser(req);
      res.json({ success: true, data: await findOpenTickets(mtpPool, Number(req.params.id)) });
    } catch (err) {
      sendError(res, err, 'ตรวจใบซ่อมค้างไม่สำเร็จ');
    }
  });

  app.get('/api/assets/:id/repair-history', async (req: Request, res: Response) => {
    try {
      await requireUser(req);
      const id = Number(req.params.id);
      const asset = await mtpPool.query(
        `SELECT a.*, d.name AS department_name FROM assets a
           LEFT JOIN departments d ON d.department_id = a.department_id WHERE a.asset_id = $1`,
        [id]
      );
      if (asset.rows.length === 0) throw new HttpError(404, 'ไม่พบครุภัณฑ์');
      const [summary, tickets, costPct, count12] = await Promise.all([
        mtpPool.query('SELECT * FROM v_asset_repair_summary WHERE asset_id = $1', [id]),
        mtpPool.query(
          `SELECT t.ticket_id, t.ticket_no, t.title, t.description, t.status, t.close_result, t.created_date, t.closed_date,
                  asg.firstname || ' ' || COALESCE(asg.lastname, '') AS assignee_name, ev.score,
                  ${TICKET_COST_SQL} AS total_cost
             FROM repair_tickets t
             LEFT JOIN person asg ON asg.person_id = t.assignee_id
             LEFT JOIN repair_evaluations ev ON ev.ticket_id = t.ticket_id
            WHERE t.asset_id = $1 ORDER BY t.created_date DESC`,
          [id]
        ),
        getSetting(mtpPool, 'replace_suggest_cost_pct', '50'),
        getSetting(mtpPool, 'replace_suggest_count_12m', '4'),
      ]);

      // MTBF: ช่วงห่างเฉลี่ย (วัน) ระหว่างวันที่แจ้งของใบที่ต่อกัน
      const dates = tickets.rows
        .map((t) => new Date(t.created_date).getTime())
        .sort((a, b) => a - b);
      const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / 86_400_000);
      const mtbf = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;

      const s = summary.rows[0] || { repair_count: 0, repair_count_12m: 0, downtime_days: 0, avg_score: null };
      res.json({
        success: true,
        data: {
          asset: { ...asset.rows[0], asset_type: assetTypeOf(asset.rows[0].equipment_type_id) },
          summary: {
            ...s,
            mtbf_days: mtbf,
            total_cost: tickets.rows.reduce((a, r) => a + (Number(r.total_cost) || 0), 0),
          },
          replace_suggestion: s.repair_count_12m >= Number(count12)
            ? { reason: `ซ่อม ${s.repair_count_12m} ครั้งใน 12 เดือน (เกณฑ์ ${count12} ครั้ง)`, cost_pct_threshold: Number(costPct) }
            : null,
          tickets: tickets.rows,
        },
      });
    } catch (err) {
      sendError(res, err, 'โหลดประวัติซ่อมไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- settings
  app.get('/api/repair-settings', async (req: Request, res: Response) => {
    try {
      await requireUser(req);
      const { rows } = await mtpPool.query(
        `SELECT s.*, p.firstname || ' ' || COALESCE(p.lastname, '') AS modify_by_name
           FROM repair_settings s LEFT JOIN person p ON p.person_id = s.modify_by ORDER BY s.setting_key`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดค่าตั้งระบบไม่สำเร็จ');
    }
  });

  app.patch('/api/repair-settings/:key', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      if (!can(u, 'repair.settings')) throw new HttpError(403, 'คุณไม่มีสิทธิ์แก้ค่าตั้งระบบ');
      const reason = String(req.body.reason || '').trim();
      if (!reason) throw new HttpError(400, 'กรุณาระบุเหตุผลการแก้ไข');
      const value = String(req.body.value ?? '').trim();
      const row = await withTx({ userId: u.person_id, reason, ip: clientIp(req) }, async (client) => {
        const cur = await client.query('SELECT * FROM repair_settings WHERE setting_key = $1 FOR UPDATE', [req.params.key]);
        if (cur.rows.length === 0) throw new HttpError(404, 'ไม่พบค่าตั้งนี้');
        const type = cur.rows[0].value_type;
        if (type === 'NUMBER' && (value === '' || isNaN(Number(value)) || Number(value) < 0)) {
          throw new HttpError(400, 'ค่าต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
        }
        if (type === 'BOOLEAN' && !['true', 'false'].includes(value)) throw new HttpError(400, 'ค่าต้องเป็น true หรือ false');
        if (type === 'JSON') {
          try { JSON.parse(value); } catch { throw new HttpError(400, 'ค่าต้องเป็น JSON ที่ถูกต้อง'); }
        }
        const upd = await client.query(
          `UPDATE repair_settings SET setting_value = $1, modify_by = $2, modify_date = NOW()
            WHERE setting_key = $3 RETURNING *`,
          [value, u.person_id, req.params.key]
        );
        return upd.rows[0];
      });
      res.json({ success: true, data: row });
    } catch (err) {
      sendError(res, err, 'บันทึกค่าตั้งระบบไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- SLA rules
  app.get('/api/repair-sla-rules', async (req: Request, res: Response) => {
    try {
      await requireUser(req);
      const { rows } = await mtpPool.query(
        `SELECT sla_rule_id, status, urgency, asset_type, warn_after_hours::FLOAT AS warn_after_hours, is_active
           FROM repair_sla_rules ORDER BY sla_rule_id`
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดกฎ SLA ไม่สำเร็จ');
    }
  });

  app.put('/api/repair-sla-rules/:id', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      if (!can(u, 'repair.settings')) throw new HttpError(403, 'คุณไม่มีสิทธิ์แก้กฎ SLA');
      const reason = String(req.body.reason || '').trim();
      if (!reason) throw new HttpError(400, 'กรุณาระบุเหตุผลการแก้ไข');
      const warn = Number(req.body.warn_after_hours);
      if (!(warn > 0)) throw new HttpError(400, 'เวลาเตือนต้องมากกว่า 0 ชั่วโมง');
      const row = await withTx({ userId: u.person_id, reason, ip: clientIp(req) }, async (client) => {
        const upd = await client.query(
          `UPDATE repair_sla_rules SET warn_after_hours = $1, is_active = $2, modify_by = $3, modify_date = NOW()
            WHERE sla_rule_id = $4 RETURNING *`,
          [warn, req.body.is_active !== false, u.person_id, req.params.id]
        );
        if (upd.rows.length === 0) throw new HttpError(404, 'ไม่พบกฎ SLA');
        return upd.rows[0];
      });
      res.json({ success: true, data: row });
    } catch (err) {
      sendError(res, err, 'บันทึกกฎ SLA ไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- audit logs
  app.get('/api/repair-audit-logs', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      if (!can(u, 'repair.audit.view')) throw new HttpError(403, 'คุณไม่มีสิทธิ์ดูประวัติการตั้งค่า');
      const params: unknown[] = [];
      const where: string[] = [];
      if (req.query.table) { params.push(String(req.query.table)); where.push(`l.table_name = $${params.length}`); }
      if (req.query.ticket_id) { params.push(Number(req.query.ticket_id)); where.push(`l.ticket_id = $${params.length}`); }
      if (req.query.from) { params.push(String(req.query.from)); where.push(`l.changed_at >= $${params.length}::date`); }
      if (req.query.to) { params.push(String(req.query.to)); where.push(`l.changed_at < $${params.length}::date + 1`); }
      const { rows } = await mtpPool.query(
        `SELECT l.*, p.firstname || ' ' || COALESCE(p.lastname, '') AS changed_by_name
           FROM repair_audit_logs l LEFT JOIN person p ON p.person_id = l.changed_by
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY l.changed_at DESC, l.log_id DESC LIMIT 500`,
        params
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดประวัติการตั้งค่าไม่สำเร็จ');
    }
  });

  // ---------------------------------------------------------------- notifications
  app.get('/api/repair-notifications', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      const { rows } = await mtpPool.query(
        `SELECT n.*, t.ticket_no FROM repair_notifications n LEFT JOIN repair_tickets t ON t.ticket_id = n.ticket_id
          WHERE n.person_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
        [u.person_id]
      );
      res.json({ success: true, data: rows, unread: rows.filter((r) => !r.is_read).length });
    } catch (err) {
      sendError(res, err, 'โหลดการแจ้งเตือนไม่สำเร็จ');
    }
  });

  app.post('/api/repair-notifications/read', async (req: Request, res: Response) => {
    try {
      const u = await requireUser(req);
      await mtpPool.query(
        `UPDATE repair_notifications SET is_read = TRUE, read_at = NOW() WHERE person_id = $1 AND NOT is_read`,
        [u.person_id]
      );
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'อัปเดตการแจ้งเตือนไม่สำเร็จ');
    }
  });
}
