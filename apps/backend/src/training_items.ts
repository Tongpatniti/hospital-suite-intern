import { Express, Request, Response } from 'express';
import db from './db';

const mtpPool = db.mtpPool;

// ===========================================================================
// ตัวอย่างโมดูล CRUD ครบวงจร — ใช้เป็นแม่แบบให้ทุกโมดูลใหม่
//   GET    /api/training/items?page=&page_size=&q=
//   POST   /api/training/items
//   PUT    /api/training/items/:id
//   DELETE /api/training/items/:id
// ===========================================================================
export function trainingItemsRoutes(app: Express) {
  app.get('/api/training/items', async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size || '20'), 10) || 20));
    const q = String(req.query.q || '').trim();
    const offset = (page - 1) * pageSize;

    const where = q ? `WHERE code ILIKE $1 OR name ILIKE $1 OR category ILIKE $1` : '';
    const params: unknown[] = q ? [`%${q}%`] : [];

    try {
      const totalResult = await mtpPool.query(
        `SELECT COUNT(*)::int AS total FROM training_items ${where}`,
        params
      );
      const total = totalResult.rows[0].total as number;

      const { rows } = await mtpPool.query(
        `SELECT * FROM training_items ${where}
         ORDER BY item_id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
      );

      res.json({
        success: true,
        data: rows,
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (err) {
      console.error('Error fetching training items', err);
      res.status(500).json({ success: false, message: 'Failed to fetch items.' });
    }
  });

  app.post('/api/training/items', async (req: Request, res: Response) => {
    const { code, name, category, price, is_active, note, create_by } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'code and name are required.' });
    }
    try {
      const { rows } = await mtpPool.query(
        `INSERT INTO training_items (code, name, category, price, is_active, note, create_by, create_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [code, name, category || null, price ?? 0, is_active ?? true, note || null, create_by || null]
      );
      res.status(201).json({ success: true, data: rows[0] });
    } catch (err: unknown) {
      console.error('Error creating training item', err);
      if (typeof err === 'object' && err && (err as { code?: string }).code === '23505') {
        return res.status(409).json({ success: false, message: 'code นี้ถูกใช้แล้ว' });
      }
      res.status(500).json({ success: false, message: 'Failed to create item.' });
    }
  });

  app.put('/api/training/items/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { code, name, category, price, is_active, note, modify_by } = req.body;
    try {
      const { rows } = await mtpPool.query(
        `UPDATE training_items
         SET code = $1, name = $2, category = $3, price = $4, is_active = $5, note = $6,
             modify_by = $7, modify_date = NOW()
         WHERE item_id = $8
         RETURNING *`,
        [code, name, category || null, price ?? 0, is_active ?? true, note || null, modify_by || null, id]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, message: 'Item not found.' });
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error('Error updating training item', err);
      res.status(500).json({ success: false, message: 'Failed to update item.' });
    }
  });

  app.delete('/api/training/items/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      await mtpPool.query('DELETE FROM training_items WHERE item_id = $1', [id]);
      res.json({ success: true, message: 'Item deleted successfully.' });
    } catch (err) {
      console.error('Error deleting training item', err);
      res.status(500).json({ success: false, message: 'Failed to delete item.' });
    }
  });
}
