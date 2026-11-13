import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { fmtMoney } from '../lib/format';
import { emptyPart, partsTotal, todayLocal, type ExternalForm, type PartRow } from '../lib/stepForms';
import { cn } from '@repo/ui/utils';
import { AttachmentGallery, AttachmentPicker, type Attachment } from './Attachments';

// ---------------------------------------------------------------------------
// ฟอร์มรายการอะไหล่ที่ช่างต้องการ (ใช้ตอน "สั่งซื้ออะไหล่")
// ---------------------------------------------------------------------------
export function PartsForm({ rows, onChange }: { rows: PartRow[]; onChange: (rows: PartRow[]) => void }) {
  const set = <K extends keyof PartRow>(i: number, k: K, v: PartRow[K]) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 rounded-md border bg-slate-50 p-2">
          <div className="col-span-12 sm:col-span-7 space-y-1">
            <Label htmlFor={`pn${i}`} className="text-xs">ชื่ออะไหล่ *</Label>
            <Input id={`pn${i}`} className="h-9" value={r.part_name} onChange={(e) => set(i, 'part_name', e.target.value)} placeholder="เช่น Power Supply 500W" />
          </div>
          <div className="col-span-12 sm:col-span-5 space-y-1">
            <Label htmlFor={`pno${i}`} className="text-xs">รหัส / รุ่น</Label>
            <Input id={`pno${i}`} className="h-9" value={r.part_no} onChange={(e) => set(i, 'part_no', e.target.value)} />
          </div>
          <div className="col-span-4 sm:col-span-2 space-y-1">
            <Label htmlFor={`q${i}`} className="text-xs">จำนวน *</Label>
            <Input id={`q${i}`} className="h-9" type="number" min="1" step="1" value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
          </div>
          <div className="col-span-4 sm:col-span-2 space-y-1">
            <Label htmlFor={`u${i}`} className="text-xs">หน่วย</Label>
            <Input id={`u${i}`} className="h-9" value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} />
          </div>
          <div className="col-span-4 sm:col-span-3 space-y-1">
            <Label htmlFor={`p${i}`} className="text-xs">ราคาประมาณ/หน่วย</Label>
            <Input id={`p${i}`} className="h-9" type="number" min="0" step="0.01" value={r.estimated_unit_price} onChange={(e) => set(i, 'estimated_unit_price', e.target.value)} />
          </div>
          <div className="col-span-10 sm:col-span-4 space-y-1">
            <Label htmlFor={`n${i}`} className="text-xs">หมายเหตุ</Label>
            <Input id={`n${i}`} className="h-9" value={r.note} onChange={(e) => set(i, 'note', e.target.value)} />
          </div>
          <div className="col-span-2 sm:col-span-1 flex items-end justify-end">
            <Button type="button" variant="ghost" size="icon" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="ลบรายการ">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="col-span-12 space-y-1">
            <Label className={cn('text-xs', r.part_name.trim() && r.files.length === 0 && 'text-red-600')}>
              รูปอะไหล่ * (อย่างน้อย 1 รูป)
            </Label>
            <AttachmentPicker files={r.files} onChange={(f) => set(i, 'files', f)} imagesOnly hint="รูปอะไหล่ชิ้นเดิม / ป้ายรุ่น / ตัวอย่างที่ต้องการ" />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyPart()])}>
          <Plus className="mr-1 h-4 w-4" /> เพิ่มรายการ
        </Button>
        <p className="text-sm text-slate-600">ยอดประมาณ <span className="font-semibold tabular-nums">{fmtMoney(partsTotal(rows))}</span> บาท</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ตารางอะไหล่ในหน้าใบซ่อม — พัสดุใส่ราคาจริงได้
// ---------------------------------------------------------------------------
export interface Part {
  part_id: number;
  part_name: string;
  part_no: string | null;
  qty: number;
  unit: string | null;
  estimated_unit_price: number | null;
  actual_unit_price: number | null;
  note: string | null;
  status: string;
  requested_by_name: string | null;
}

const PART_STATUS: Record<string, string> = {
  REQUESTED: 'ขอซื้อ', PURCHASING: 'กำลังจัดซื้อ', ARRIVED: 'ถึงคลัง', ISSUED: 'ช่างรับแล้ว', CANCELLED: 'ยกเลิก',
};

export function PartsTable({ ticketId, parts, attachments, canEditPrice, onSaved }: {
  ticketId: number; parts: Part[]; attachments: Attachment[]; canEditPrice: boolean; onSaved: () => void;
}) {
  const photosOf = (partId: number) => attachments.filter((a) => a.reference_type === 'PART' && a.reference_id === partId);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const save = async (p: Part) => {
    const value = draft[p.part_id];
    let reason = '';
    if (p.actual_unit_price !== null && Number(value) !== p.actual_unit_price) {
      reason = 'แก้ไขราคาจริง';
    }
    setSaving(p.part_id);
    try {
      await api.put(`/api/repairs/${ticketId}/parts/${p.part_id}`, { actual_unit_price: value === '' ? null : Number(value), reason });
      toast({ title: `บันทึกราคา ${p.part_name} แล้ว` });
      setDraft((d) => { const n = { ...d }; delete n[p.part_id]; return n; });
      onSaved();
    } catch (err) {
      toast({ title: errorMessage(err, 'บันทึกราคาไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const total = parts.filter((p) => p.status !== 'CANCELLED')
    .reduce((s, p) => s + p.qty * (p.actual_unit_price ?? p.estimated_unit_price ?? 0), 0);

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px] text-sm">
        <TableHeader className="bg-slate-100">
          <TableRow>
            <TableHead>อะไหล่</TableHead>
            <TableHead className="w-24 text-right">จำนวน</TableHead>
            <TableHead className="w-28 text-right">ราคาประมาณ</TableHead>
            <TableHead className="w-40 text-right">ราคาจริง/หน่วย</TableHead>
            <TableHead className="w-24">สถานะ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parts.map((p) => (
            <TableRow key={p.part_id}>
              <TableCell>
                <div className="font-medium">{p.part_name}</div>
                <div className="text-xs text-slate-500">{[p.part_no, p.note].filter(Boolean).join(' · ') || '–'}</div>
                {photosOf(p.part_id).length > 0 && (
                  <div className="mt-1 max-w-[16rem]">
                    <AttachmentGallery ticketId={ticketId} items={photosOf(p.part_id)} compact />
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.qty} {p.unit}</TableCell>
              <TableCell className="text-right tabular-nums">{p.estimated_unit_price != null ? fmtMoney(p.estimated_unit_price) : '–'}</TableCell>
              <TableCell className="text-right">
                {canEditPrice ? (
                  <div className="flex justify-end gap-1">
                    <Input
                      className="h-8 w-24 text-right" type="number" min="0" step="0.01" aria-label={`ราคาจริง ${p.part_name}`}
                      value={draft[p.part_id] ?? (p.actual_unit_price ?? '')}
                      onChange={(e) => setDraft({ ...draft, [p.part_id]: e.target.value })}
                    />
                    {draft[p.part_id] !== undefined && (
                      <Button size="sm" className="h-8 bg-teal-700 hover:bg-teal-800" disabled={saving === p.part_id} onClick={() => save(p)}>บันทึก</Button>
                    )}
                  </div>
                ) : (
                  <span className="tabular-nums">{p.actual_unit_price != null ? fmtMoney(p.actual_unit_price) : '–'}</span>
                )}
              </TableCell>
              <TableCell><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{PART_STATUS[p.status] || p.status}</span></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-right text-sm text-slate-600">รวม <span className="font-semibold tabular-nums">{fmtMoney(total)}</span> บาท</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ส่งซ่อมภายนอก
// ---------------------------------------------------------------------------
export interface External {
  external_id: number;
  status: string;
  is_warranty: boolean;
  reason: string | null;
  suggested_vendor: string | null;
  requested_by_name: string | null;
  requested_date: string;
  vendor_name: string | null;
  quoted_price: number | null;
  sent_date: string | null;
  return_date: string | null;
  actual_cost: number | null;
  invoice_no: string | null;
}


export function ExternalFields({ step, form, onChange }: { step: 'request' | 'price' | 'send' | 'receive'; form: ExternalForm; onChange: (f: ExternalForm) => void }) {
  const set = <K extends keyof ExternalForm>(k: K, v: ExternalForm[K]) => onChange({ ...form, [k]: v });
  const [vendors, setVendors] = useState<string[]>([]);
  useEffect(() => {
    api.get('/api/repair-vendors').then((r) => setVendors(r.data.data)).catch(() => setVendors([]));
  }, []);
  const vendorList = <datalist id="vendor-options">{vendors.map((v) => <option key={v} value={v} />)}</datalist>;
  if (step === 'request') {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="sv">ร้านที่เสนอ (ถ้ามี)</Label>
          <Input id="sv" list="vendor-options" placeholder="เลือกจากรายการหรือพิมพ์ใหม่" value={form.suggested_vendor} onChange={(e) => set('suggested_vendor', e.target.value)} />
          {vendorList}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_warranty} onChange={(e) => set('is_warranty', e.target.checked)} />
          อยู่ในระยะประกัน
        </label>
      </div>
    );
  }
  if (step === 'price') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="vn">ร้านที่ส่งซ่อม *</Label>
          <Input id="vn" list="vendor-options" placeholder="เลือกจากรายการหรือพิมพ์ใหม่" value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} />
          {vendorList}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="qp">ราคาที่ร้านเสนอ (บาท) *</Label>
          <Input id="qp" type="number" min="0" step="0.01" value={form.quoted_price} onChange={(e) => set('quoted_price', e.target.value)} />
        </div>
      </div>
    );
  }
  if (step === 'send') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sd">วันที่ส่ง *</Label>
          <Input id="sd" type="date" required max={todayLocal()} value={form.sent_date} onChange={(e) => set('sent_date', e.target.value)} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="rd">วันที่รับคืน *</Label>
        <Input id="rd" type="date" required max={todayLocal()} value={form.return_date} onChange={(e) => set('return_date', e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ac">ค่าซ่อม (บาท) *</Label>
        <Input id="ac" type="number" min="0" step="0.01" value={form.actual_cost} onChange={(e) => set('actual_cost', e.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="iv">เลขใบแจ้งหนี้ / ใบเสร็จ</Label>
        <Input id="iv" value={form.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} />
      </div>
    </div>
  );
}

export function ExternalSummary({ items }: { items: External[] }) {
  return (
    <div className="space-y-3 text-sm">
      {items.map((e) => (
        <dl key={e.external_id} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3">
          <dt className="text-slate-500">ส่งเรื่องโดย</dt><dd>{e.requested_by_name || '-'}{(e.vendor_name || e.suggested_vendor) && ` · ${e.vendor_name || e.suggested_vendor}`}{e.is_warranty && ' · ในประกัน'}</dd>
          {e.reason && (<><dt className="text-slate-500">เหตุผล</dt><dd>{e.reason}</dd></>)}
          {e.suggested_vendor && (<><dt className="text-slate-500">ร้านที่ช่างเสนอ</dt><dd>{e.suggested_vendor}</dd></>)}
          <dt className="text-slate-500">ร้านที่ส่ง</dt><dd>{e.vendor_name || 'รอพัสดุดำเนินการ'}</dd>
          {e.quoted_price != null && (<><dt className="text-slate-500">ราคาที่ร้านเสนอ</dt><dd className="tabular-nums">{fmtMoney(e.quoted_price)} บาท</dd></>)}
          {e.sent_date && (<><dt className="text-slate-500">วันที่ส่ง</dt><dd>{e.sent_date}</dd></>)}
          {e.return_date && (<><dt className="text-slate-500">วันที่รับคืน</dt><dd>{e.return_date}</dd></>)}
          {e.actual_cost != null && (<><dt className="text-slate-500">ค่าซ่อม</dt><dd className="tabular-nums">{fmtMoney(e.actual_cost)} บาท</dd></>)}
          {e.invoice_no && (<><dt className="text-slate-500">ใบแจ้งหนี้</dt><dd>{e.invoice_no}</dd></>)}
        </dl>
      ))}
    </div>
  );
}
