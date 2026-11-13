import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PoolClient } from 'pg';
import { HttpError, can, getCurrentUser, getSetting, mtpPool, sendError } from './repair_common';

// ===========================================================================
// ไฟล์แนบใบซ่อม (spec 8.9)
//   POST   /api/repairs/:id/attachments                 { file_name, data, thumb?, original_size?, width?, height?, reference_type? }
//   GET    /api/repairs/:id/attachments/:attachmentId   (?thumb=1)
//   DELETE /api/repairs/:id/attachments/:attachmentId
//
// ฝั่งเว็บย่อรูปก่อนส่ง (ด้านยาว <= attach_image_max_px, แปลงเป็น WebP/JPEG ซึ่งลบ EXIF/GPS ไปในตัว)
// ฝั่งนี้ตรวจชนิดจากเนื้อไฟล์ (magic bytes) ขนาด จำนวน และไฟล์ซ้ำ แล้วเก็บลงดิสก์
// ส่งทีละ 1 ไฟล์ต่อ request (base64 ใน JSON) เพื่อไม่ต้องเพิ่มไลบรารี multipart
// ===========================================================================

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.resolve(__dirname, '..', 'uploads', 'repair'));

type Kind = { kind: 'IMAGE' | 'PDF'; mime: string; ext: string };

function detect(buf: Buffer): Kind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'IMAGE', mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'IMAGE', mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { kind: 'IMAGE', mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { kind: 'PDF', mime: 'application/pdf', ext: 'pdf' };
  return null;
}

function decode(data: unknown): Buffer {
  const s = String(data || '');
  const b64 = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s;
  return Buffer.from(b64, 'base64');
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'file';
}

function resolveStored(stored: string) {
  const full = path.resolve(UPLOAD_DIR, stored);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new HttpError(400, 'ชื่อไฟล์ไม่ถูกต้อง');
  return full;
}

/** ผูกไฟล์ที่อัปโหลดรอไว้ (STATUS, reference_id NULL) เข้ากับแถว history — เรียกภายใน transaction เปลี่ยนสถานะ */
export async function linkStatusAttachments(
  client: PoolClient,
  ticketId: number,
  personId: number,
  historyId: number,
  ids: number[]
) {
  if (ids.length === 0) return { linked: 0, images: 0 };
  const { rows } = await client.query(
    `UPDATE repair_attachments SET reference_id = $1
      WHERE ticket_id = $2 AND uploaded_by = $3 AND attachment_id = ANY($4)
        AND reference_type = 'STATUS' AND reference_id IS NULL AND deleted_at IS NULL
      RETURNING file_kind`,
    [historyId, ticketId, personId, ids]
  );
  return { linked: rows.length, images: rows.filter((r) => r.file_kind === 'IMAGE').length };
}

export async function listAttachments(ticketId: number) {
  try {
    return await queryAttachments(ticketId);
  } catch (err) {
    // ยังไม่ได้รัน db:setup:repair หลังเพิ่มตารางไฟล์แนบ — ให้หน้าใบซ่อมยังเปิดได้
    if ((err as { code?: string }).code === '42P01') {
      console.warn('[repair] ไม่พบตาราง repair_attachments — รัน pnpm --filter backend db:setup:repair');
      return [];
    }
    throw err;
  }
}

async function queryAttachments(ticketId: number) {
  const { rows } = await mtpPool.query(
    `SELECT a.attachment_id, a.reference_type, a.reference_id, a.file_kind, a.file_name, a.mime_type,
            a.original_size, a.file_size, a.width, a.height, a.uploaded_by, a.uploaded_at,
            (a.thumbnail_name IS NOT NULL) AS has_thumb,
            p.firstname || ' ' || COALESCE(p.lastname, '') AS uploaded_by_name
       FROM repair_attachments a LEFT JOIN person p ON p.person_id = a.uploaded_by
      WHERE a.ticket_id = $1 AND a.deleted_at IS NULL
        AND NOT (a.reference_type IN ('STATUS', 'PART') AND a.reference_id IS NULL)
      ORDER BY a.uploaded_at`,
    [ticketId]
  );
  return rows;
}

export function repairAttachmentRoutes(app: Express) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  app.post('/api/repairs/:id/attachments', async (req: Request, res: Response) => {
    const written: string[] = [];
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่');
      const ticketId = Number(req.params.id);
      // STATUS / PART = อัปโหลดไว้ก่อน แล้วผูกตอนเปลี่ยนสถานะ / ตอนสร้างรายการอะไหล่
      const refType = ['STATUS', 'PART'].includes(req.body.reference_type) ? req.body.reference_type : 'TICKET';

      const t = await mtpPool.query('SELECT ticket_id, status, requester_id, assignee_id FROM repair_tickets WHERE ticket_id = $1', [ticketId]);
      if (t.rows.length === 0) throw new HttpError(404, 'ไม่พบใบซ่อม');
      if (['CLOSED', 'CANCELLED'].includes(t.rows[0].status) && !can(u, 'repair.settings')) {
        throw new HttpError(400, 'ใบซ่อมปิดแล้ว แนบไฟล์เพิ่มไม่ได้');
      }

      const buf = decode(req.body.data);
      const kind = detect(buf);
      if (!kind) throw new HttpError(400, 'รองรับเฉพาะไฟล์รูป (JPG, PNG, WEBP, HEIC) และ PDF');

      const [imgMax, pdfMax, maxFiles] = await Promise.all([
        getSetting(mtpPool, 'attach_image_max_mb', '15'),
        getSetting(mtpPool, 'attach_pdf_max_mb', '10'),
        getSetting(mtpPool, 'attach_max_files_per_ticket', '30'),
      ]);
      const limitMb = Number(kind.kind === 'PDF' ? pdfMax : imgMax);
      if (buf.length > limitMb * 1024 * 1024) {
        throw new HttpError(400, `ไฟล์ใหญ่เกินกำหนด (${kind.kind === 'PDF' ? 'PDF' : 'รูป'} สูงสุด ${limitMb} MB)`);
      }
      if (kind.kind === 'PDF') {
        const text = buf.toString('latin1');
        if (/\/Encrypt\b/.test(text)) throw new HttpError(400, 'ไม่รับ PDF ที่ตั้งรหัสผ่านหรือเข้ารหัสไว้');
        if (/\/(JavaScript|JS)\b/.test(text)) throw new HttpError(400, 'ไม่รับ PDF ที่มีสคริปต์ฝังอยู่');
      }

      const count = await mtpPool.query(
        'SELECT COUNT(*)::int AS n FROM repair_attachments WHERE ticket_id = $1 AND deleted_at IS NULL',
        [ticketId]
      );
      if (count.rows[0].n >= Number(maxFiles)) throw new HttpError(400, `แนบไฟล์ได้สูงสุด ${maxFiles} ไฟล์ต่อใบซ่อม`);

      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const dup = await mtpPool.query(
        'SELECT file_name FROM repair_attachments WHERE ticket_id = $1 AND sha256 = $2 AND deleted_at IS NULL',
        [ticketId, sha]
      );
      if (dup.rows.length > 0) throw new HttpError(409, `ไฟล์นี้แนบไว้แล้ว (${dup.rows[0].file_name})`);

      const now = new Date();
      const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      fs.mkdirSync(path.join(UPLOAD_DIR, sub), { recursive: true });
      const id = crypto.randomUUID();
      const stored = `${sub}/${id}.${kind.ext}`;
      fs.writeFileSync(resolveStored(stored), buf);
      written.push(resolveStored(stored));

      let thumbName: string | null = null;
      if (kind.kind === 'IMAGE' && req.body.thumb) {
        const tb = decode(req.body.thumb);
        const tk = detect(tb);
        if (tk && tk.kind === 'IMAGE' && tb.length < 1024 * 1024) {
          thumbName = `${sub}/${id}_thumb.${tk.ext}`;
          fs.writeFileSync(resolveStored(thumbName), tb);
          written.push(resolveStored(thumbName));
        }
      }

      const { rows } = await mtpPool.query(
        `INSERT INTO repair_attachments (ticket_id, reference_type, reference_id, file_kind, file_name, stored_name,
                                         thumbnail_name, mime_type, original_size, file_size, width, height, sha256, uploaded_by)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING attachment_id, reference_type, file_kind, file_name, mime_type, original_size, file_size, width, height,
                   uploaded_at, (thumbnail_name IS NOT NULL) AS has_thumb`,
        [ticketId, refType, kind.kind, safeName(String(req.body.file_name || `file.${kind.ext}`)), stored, thumbName,
         kind.mime, Number(req.body.original_size) || buf.length, buf.length,
         Number(req.body.width) || null, Number(req.body.height) || null, sha, u.person_id]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      for (const f of written) fs.rmSync(f, { force: true });
      const pg = err as { code?: string };
      if (pg && pg.code === '23505') return res.status(409).json({ success: false, message: 'ไฟล์นี้แนบไว้แล้ว' });
      sendError(res, err, 'แนบไฟล์ไม่สำเร็จ');
    }
  });

  // ส่งไฟล์ (ต้องส่ง header x-person-id — หน้าเว็บโหลดเป็น blob)
  app.get('/api/repairs/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      const { rows } = await mtpPool.query(
        `SELECT * FROM repair_attachments WHERE attachment_id = $1 AND ticket_id = $2 AND deleted_at IS NULL`,
        [req.params.attachmentId, req.params.id]
      );
      const a = rows[0];
      if (!a) throw new HttpError(404, 'ไม่พบไฟล์');
      const useThumb = req.query.thumb === '1' && a.thumbnail_name;
      const file = resolveStored(useThumb ? a.thumbnail_name : a.stored_name);
      if (!fs.existsSync(file)) throw new HttpError(404, 'ไม่พบไฟล์บนเซิร์ฟเวอร์');
      const mime = useThumb ? (file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg') : a.mime_type;
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      sendError(res, err, 'เปิดไฟล์ไม่สำเร็จ');
    }
  });

  app.delete('/api/repairs/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
    try {
      const u = await getCurrentUser(req);
      if (!u) throw new HttpError(401, 'ไม่พบผู้ใช้งาน');
      const { rows } = await mtpPool.query(
        `SELECT a.*, t.status AS ticket_status FROM repair_attachments a JOIN repair_tickets t ON t.ticket_id = a.ticket_id
          WHERE a.attachment_id = $1 AND a.ticket_id = $2 AND a.deleted_at IS NULL`,
        [req.params.attachmentId, req.params.id]
      );
      const a = rows[0];
      if (!a) throw new HttpError(404, 'ไม่พบไฟล์');
      if (a.uploaded_by !== u.person_id && !can(u, 'repair.settings')) throw new HttpError(403, 'ลบได้เฉพาะไฟล์ที่คุณแนบเอง');
      if (['CLOSED', 'CANCELLED'].includes(a.ticket_status)) throw new HttpError(400, 'ใบซ่อมปิดแล้ว ลบไฟล์ไม่ได้');
      if (a.reference_type === 'STATUS' && a.reference_id !== null) throw new HttpError(400, 'ไฟล์ที่ใช้ยืนยันการเปลี่ยนสถานะแล้ว ลบไม่ได้');
      if (a.reference_type === 'PART' && a.reference_id !== null) throw new HttpError(400, 'รูปของรายการอะไหล่ลบไม่ได้');
      await mtpPool.query('UPDATE repair_attachments SET deleted_by = $1, deleted_at = NOW() WHERE attachment_id = $2', [u.person_id, a.attachment_id]);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, 'ลบไฟล์ไม่สำเร็จ');
    }
  });
}
