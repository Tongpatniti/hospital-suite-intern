import {
  AssetType,
  OPEN_EXCLUDED,
  STATUS_ACTOR,
  STATUS_LABEL,
  getSetting,
  mtpPool,
  notify,
  personsWithPermission,
  techPermission,
} from './repair_common';

// ===========================================================================
// แจ้งเตือนงานค้าง (spec 8.8)
// รันทุก sla_scan_interval_min นาที; ใช้ advisory lock ให้รันที่เดียวเมื่อมีหลาย instance
// repair_sla_alerts UNIQUE (history_id, level) กันส่งซ้ำ
// ===========================================================================

const LOCK_KEY = 72_031_001;

interface Due {
  ticket_id: number;
  ticket_no: string;
  title: string;
  status: string;
  asset_type: AssetType;
  requester_id: number;
  assignee_id: number | null;
  created_date: string;
  history_id: number;
  prev_actor: number | null;
  hours: number;
  sla_rule_id: number;
  warn_after_hours: number;
  notify_requester: boolean;
  notify_current_actor: boolean;
  notify_prev_actor: boolean;
}

async function currentActors(t: Due): Promise<number[]> {
  const actor = STATUS_ACTOR[t.status];
  if (actor === 'requester') return [t.requester_id];
  if (actor === 'tech') return t.assignee_id ? [t.assignee_id] : personsWithPermission(mtpPool, techPermission(t.asset_type));
  if (actor === 'supply') return personsWithPermission(mtpPool, 'repair.supply');
  if (actor === 'approver') return personsWithPermission(mtpPool, 'repair.approve');
  return [];
}

function fmtHours(h: number) {
  return h >= 48 ? `${(h / 24).toFixed(1)} วัน` : `${Math.floor(h)} ชม.`;
}

export async function runSlaScan(): Promise<number> {
  const client = await mtpPool.connect();
  let sent = 0;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!lock.rows[0].ok) return 0;
    try {
      const { rows } = await client.query<Due>(
        `SELECT t.ticket_id, t.ticket_no, t.title, t.status, t.asset_type, t.requester_id, t.assignee_id, t.created_date,
                h.history_id, h.prev_actor,
                (EXTRACT(EPOCH FROM (NOW() - t.status_entered_at)) / 3600)::FLOAT AS hours,
                r.sla_rule_id, r.warn_after_hours::FLOAT AS warn_after_hours,
                r.notify_requester, r.notify_current_actor, r.notify_prev_actor
           FROM repair_tickets t
           JOIN LATERAL (
             -- แถวที่ "เข้าสถานะปัจจุบัน" (ข้ามเหตุการณ์ย่อยที่ from = to เช่น มีผู้ติดตามเพิ่ม)
             SELECT hh.history_id, hh.changed_by AS prev_actor FROM repair_status_history hh
              WHERE hh.ticket_id = t.ticket_id AND hh.to_status = t.status
                AND hh.from_status IS DISTINCT FROM hh.to_status
              ORDER BY hh.changed_at DESC, hh.history_id DESC LIMIT 1
           ) h ON TRUE
           JOIN LATERAL (
             SELECT * FROM repair_sla_rules rr
              WHERE rr.is_active AND rr.status = t.status
                AND (rr.urgency IS NULL OR rr.urgency = t.urgency)
                AND (rr.asset_type IS NULL OR rr.asset_type = t.asset_type)
              ORDER BY (rr.urgency IS NOT NULL)::INT + (rr.asset_type IS NOT NULL)::INT DESC
              LIMIT 1
           ) r ON TRUE
          WHERE t.status <> ALL($1)
            AND t.status_entered_at <= NOW() - make_interval(secs => r.warn_after_hours * 3600)`,
        [OPEN_EXCLUDED]
      );

      // แจ้งเตือนครั้งเดียวต่อการเข้าสถานะ (ไม่มีการส่งต่อหัวหน้า)
      for (const t of rows) {
        const recipients = new Set<number>();
        if (t.notify_requester) {
          recipients.add(t.requester_id);
          const w = await client.query('SELECT person_id FROM repair_ticket_watchers WHERE ticket_id = $1', [t.ticket_id]);
          w.rows.forEach((r) => recipients.add(r.person_id));
        }
        if (t.notify_current_actor) (await currentActors(t)).forEach((id) => recipients.add(id));
        if (t.notify_prev_actor && t.prev_actor) recipients.add(t.prev_actor);
        const ids = [...recipients];

        await client.query('BEGIN');
        try {
          const ins = await client.query(
            `INSERT INTO repair_sla_alerts (ticket_id, history_id, sla_rule_id, status, level, hours_overdue, recipients)
             VALUES ($1, $2, $3, $4, 1, $5, $6)
             ON CONFLICT (history_id, level) DO NOTHING RETURNING alert_id`,
            [t.ticket_id, t.history_id, t.sla_rule_id, t.status, (t.hours - t.warn_after_hours).toFixed(2), ids]
          );
          if (ins.rows.length > 0) {
            await notify(client, ids, {
              ticket_id: t.ticket_id,
              type: 'SLA_WARNING',
              title: `งานค้างเกินเวลา: ${t.ticket_no}`,
              message: `"${STATUS_LABEL[t.status]}" ค้าง ${fmtHours(t.hours)} (กำหนด ${fmtHours(t.warn_after_hours)}) · ${t.title}`,
            });
            sent++;
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return sent;
}

export async function startSlaScheduler() {
  let minutes = 15;
  try {
    minutes = Math.max(1, Number(await getSetting(mtpPool, 'sla_scan_interval_min', '15')) || 15);
  } catch {
    // ยังไม่ได้รัน db:setup:repair — ข้ามไปก่อน
    console.warn('[repair-sla] ไม่พบตาราง repair_settings — ยังไม่เริ่มตรวจงานค้าง (รัน pnpm --filter backend db:setup:repair)');
    return;
  }
  const tick = () =>
    runSlaScan()
      .then((n) => n > 0 && console.log(`[repair-sla] ส่งแจ้งเตือนงานค้าง ${n} รายการ`))
      .catch((err) => console.error('[repair-sla] scan error', err));
  tick();
  setInterval(tick, minutes * 60_000).unref();
  console.log(`[repair-sla] ตรวจงานค้างทุก ${minutes} นาที`);
}
