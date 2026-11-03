import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api from '@repo/api-client';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Badge } from '@repo/ui/badge';
import { Card, CardContent } from '@repo/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { toast } from '@repo/ui/use-toast';
import { useAuth } from '../contexts/AuthContext';
import { fmtDateTimeTH, fmtMoney } from '../lib/format';

interface TrainingItem {
  item_id: number;
  code: string;
  name: string;
  category: string | null;
  price: string | number;
  is_active: boolean;
  note: string | null;
  create_date: string | null;
  modify_date: string | null;
}

interface FormState {
  code: string;
  name: string;
  category: string;
  price: string;
  is_active: boolean;
  note: string;
}

const emptyForm: FormState = {
  code: '',
  name: '',
  category: '',
  price: '0',
  is_active: true,
  note: '',
};

const PAGE_SIZE = 20;

const TrainingItems: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const canEdit = hasPermission('training.edit');

  const [items, setItems] = useState<TrainingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (nextPage: number, search: string) => {
    setLoading(true);
    try {
      const res = await api.get('/api/training/items', {
        params: { page: nextPage, page_size: PAGE_SIZE, q: search },
      });
      setItems(res.data.data);
      setTotal(res.data.total);
      setTotalPages(res.data.total_pages);
    } catch (err) {
      console.error('Load items error', err);
      toast({ title: 'โหลดข้อมูลไม่สำเร็จ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, q);
  }, [page, q, load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (item: TrainingItem) => {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      category: item.category || '',
      price: String(item.price),
      is_active: item.is_active,
      note: item.note || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast({ title: 'กรุณากรอกรหัสและชื่อรายการ', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      price: Number(form.price) || 0,
      create_by: user?.username,
      modify_by: user?.username,
    };
    try {
      if (editing) {
        await api.put(`/api/training/items/${editing.item_id}`, payload);
        toast({ title: 'แก้ไขรายการสำเร็จ' });
      } else {
        await api.post('/api/training/items', payload);
        toast({ title: 'เพิ่มรายการสำเร็จ' });
      }
      setDialogOpen(false);
      load(page, q);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast({ title: message || 'บันทึกไม่สำเร็จ', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: TrainingItem) => {
    if (!window.confirm(`ยืนยันลบ "${item.name}" ?`)) return;
    try {
      await api.delete(`/api/training/items/${item.item_id}`);
      toast({ title: 'ลบรายการสำเร็จ' });
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      setPage(nextPage);
      if (nextPage === page) load(page, q);
    } catch (err) {
      console.error('Delete error', err);
      toast({ title: 'ลบไม่สำเร็จ', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">รายการฝึกงาน</h1>
          <p className="text-sm text-slate-500">ตัวอย่างโมดูล CRUD — ค้นหา แบ่งหน้า เพิ่ม แก้ไข ลบ</p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" />
            เพิ่มรายการ
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="ค้นหารหัส / ชื่อ / หมวด"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <p className="text-xs text-slate-500 whitespace-nowrap">
              {total.toLocaleString()} รายการ
              {totalPages > 1 && ` · หน้า ${page}/${totalPages}`}
            </p>
          </div>

          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto rounded-md border">
            <Table className="min-w-[720px]">
              <TableHeader className="sticky top-0 z-10 bg-slate-100">
                <TableRow>
                  <TableHead className="w-28">รหัส</TableHead>
                  <TableHead>ชื่อรายการ</TableHead>
                  <TableHead className="w-40">หมวด</TableHead>
                  <TableHead className="w-28 text-right">ราคา</TableHead>
                  <TableHead className="w-24">สถานะ</TableHead>
                  <TableHead className="w-40">แก้ไขล่าสุด</TableHead>
                  {canEdit && <TableHead className="w-24 text-center">จัดการ</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-slate-400 py-8">
                      กำลังโหลด...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-slate-400 py-8">
                      ไม่พบข้อมูล
                    </TableCell>
                  </TableRow>
                )}
                {!loading &&
                  items.map((item) => (
                    <TableRow key={item.item_id}>
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-slate-600">{item.category || '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(item.price)}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_active ? 'success' : 'secondary'}>
                          {item.is_active ? 'ใช้งาน' : 'ปิด'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {fmtDateTimeTH(item.modify_date || item.create_date)}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(item)} title="แก้ไข">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => handleDelete(item)}
                              title="ลบ"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              ก่อนหน้า
            </Button>
            <span className="text-xs text-slate-500">
              หน้า {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              ถัดไป
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="code">รหัส *</Label>
                <Input
                  id="code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="TR-001"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="price">ราคา</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">ชื่อรายการ *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="category">หมวด</Label>
              <Input
                id="category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="note">หมายเหตุ</Label>
              <Input
                id="note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              เปิดใช้งาน
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainingItems;
