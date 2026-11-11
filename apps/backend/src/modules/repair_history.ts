import { Express, Request, Response } from 'express';
import { ASSET_TYPES, AssetType, HttpError, getCurrentUser, mtpPool, sendError, visibleTypes } from './repair_common';

// ===========================================================================
// ประวัติการซ่อมทั้งหมด (ทั้งที่มีและไม่มีรหัสครุภัณฑ์)
//   GET /api/repair-history?has_asset=all|yes|no&asset_type=&q=&page=&page_size=
//   GET /api/repair-asset-stats?asset_type=&q=   จำนวนครั้งที่ซ่อมต่อครุภัณฑ์ (นับทุกใบ รวมที่ยกเลิก)
// ===========================================================================

// ค่าใช้จ่ายต่อใบ = อะไหล่ (ราคาจริง ถ้าไม่มีใช้ราคาประมาณ) + ค่าซ่อมภายนอก
export const TICKET_COST_SQL = `(
  COALESCE((SELECT SUM(p.qty * COALESCE(p.actual_unit_price, p.estimated_unit_price, 0))
              FROM repair_parts p WHERE p.ticket_id = t.ticket_id AND p.status <> 'CANCELLED'), 0)
  + COALESCE((SELECT SUM(e.actual_cost) FROM repair_externals e WHERE e.ticket_id = t.ticket_id), 0)
)::float`;

export function repairHistoryRoutes(app: Express) {
  app.get('/api/repair-history', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size || '30'), 10) || 30));

      const params: unknown[] = [visibleTypes(u), u.person_id];
      const where = ['(t.asset_type = ANY($1) OR t.requester_id = $2)'];
      if (req.query.has_asset === 'yes') where.push('t.asset_id IS NOT NULL');
      if (req.query.has_asset === 'no') where.push('t.asset_id IS NULL');
      const reqType = String(req.query.asset_type || '').toUpperCase();
      if (ASSET_TYPES.includes(reqType as AssetType)) {
        params.push(reqType);
        where.push(`t.asset_type = $${params.length}`);
      }
      const q = String(req.query.q || '').trim();
      if (q) {
        params.push(`%${q}%`);
        const i = params.length;
        where.push(`(t.ticket_no ILIKE $${i} OR t.title ILIKE $${i} OR t.description ILIKE $${i}
                     OR t.asset_code_snapshot ILIKE $${i} OR t.asset_department_snapshot ILIKE $${i})`);
      }
      const w = where.join(' AND ');

      const total = await mtpPool.query(`SELECT COUNT(*)::int AS n FROM repair_tickets t WHERE ${w}`, params);
      const { rows } = await mtpPool.query(
        `SELECT t.ticket_id, t.ticket_no, t.asset_type, t.asset_id, t.asset_code_snapshot, t.title, t.description,
                t.asset_department_snapshot, t.status, t.close_result, t.created_date, t.closed_date,
                asg.firstname || ' ' || COALESCE(asg.lastname, '') AS assignee_name, ev.score,
                ${TICKET_COST_SQL} AS total_cost
           FROM repair_tickets t
           LEFT JOIN person asg ON asg.person_id = t.assignee_id
           LEFT JOIN repair_evaluations ev ON ev.ticket_id = t.ticket_id
          WHERE ${w}
          ORDER BY t.created_date DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      res.json({
        success: true,
        data: rows,
        page,
        total: total.rows[0].n,
        total_pages: Math.max(1, Math.ceil(total.rows[0].n / pageSize)),
      });
    } catch (err) {
      sendError(res, err, 'โหลดประวัติการซ่อมไม่สำเร็จ');
    }
  });

  app.get('/api/repair-asset-stats', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      const reqType = String(req.query.asset_type || '').toUpperCase();
      const typeFilter = ASSET_TYPES.includes(reqType as AssetType) ? reqType : null;
      const q = String(req.query.q || '').trim();
      const { rows } = await mtpPool.query(
        `WITH base AS (
           SELECT a.asset_id, a.asset_code, a.name, a.status, d.name AS department_name,
                  CASE WHEN a.equipment_type_id = 1 THEN 'MEDICAL'
                       WHEN a.equipment_type_id = 2 THEN 'COMPUTER'
                       ELSE 'GENERAL' END AS asset_type
             FROM assets a LEFT JOIN departments d ON d.department_id = a.department_id
         )
         SELECT b.asset_id, b.asset_code, b.name, b.status, b.department_name, b.asset_type,
                COUNT(t.ticket_id)::int AS repair_count,
                COUNT(t.ticket_id) FILTER (WHERE t.created_date >= NOW() - INTERVAL '12 months')::int AS repair_count_12m,
                COUNT(t.ticket_id) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled_count,
                MAX(t.created_date) AS last_repair_date,
                COALESCE(SUM(${TICKET_COST_SQL}), 0)::float AS total_cost
           FROM base b LEFT JOIN repair_tickets t ON t.asset_id = b.asset_id
          WHERE b.asset_type = ANY($1)
            AND ($2::text IS NULL OR b.asset_type = $2)
            AND ($3 = '' OR b.asset_code ILIKE '%' || $3 || '%' OR b.name ILIKE '%' || $3 || '%')
          GROUP BY b.asset_id, b.asset_code, b.name, b.status, b.department_name, b.asset_type
          ORDER BY repair_count DESC, b.asset_code
          LIMIT 500`,
        [visibleTypes(u), typeFilter, q]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      sendError(res, err, 'โหลดสถิติครุภัณฑ์ไม่สำเร็จ');
    }
  });
}
