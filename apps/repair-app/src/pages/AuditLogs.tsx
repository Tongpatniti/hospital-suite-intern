import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { fmtDateTimeTH } from '../lib/format';

interface Log {
  log_id: number;
  table_name: string;
  record_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_fields: string[] | null;
  reason: string | null;
  changed_by: number | null;
  changed_by_name: string | null;
  db_user: string;
  changed_at: string;
}

const TABLE_LABEL: Record<string, string> = {
  repair_settings: 'ค่าตั้งระบบ',
  repair_sla_rules: 'เวลาที่กำหนด (SLA)',
  assets: 'สถานะครุภัณฑ์',
};

const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const AuditLogs: React.FC = () => {
  const [rows, setRows] = useState<Log[]>([]);
  const [table, setTable] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/repair-audit-logs', { params: { table: table || undefined, from: from || undefined, to: to || undefined } });
      setRows(res.data.data);
    } catch (err) {
      toast({ title: errorMessage(err, 'โหลดประวัติไม่สำเร็จ'), variant: 'destructive' });
    }
  }, [table, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ประวัติการแก้ไข</h1>
        <p className="text-sm text-slate-500">บันทึกถาวรโดย trigger ในฐานข้อมูล แก้ไขหรือลบไม่ได้</p>
      </div>
      <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label htmlFor="tbl">หมวด</Label>
          <select id="tbl" className="h-10 rounded-md border px-2 text-sm" value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="from">ตั้งแต่วันที่</Label><Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="to">ถึงวันที่</Label><Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader className="bg-slate-100">
              <TableRow>
                <TableHead className="w-36">เวลา</TableHead><TableHead className="w-40">ผู้แก้</TableHead>
                <TableHead className="w-48">รายการ</TableHead><TableHead>ค่าเดิม → ค่าใหม่</TableHead><TableHead className="w-56">เหตุผล</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-400">ไม่พบรายการ</TableCell></TableRow>}
              {rows.map((l) => {
                const direct = !l.changed_by;
                return (
                  <TableRow key={l.log_id} className={direct ? 'bg-red-50' : ''}>
                    <TableCell className="font-mono text-xs">{fmtDateTimeTH(l.changed_at)}</TableCell>
                    <TableCell className="text-sm">
                      {direct ? <span className="font-semibold text-red-600">แก้ตรงในฐานข้อมูล ({l.db_user})</span> : l.changed_by_name}
                    </TableCell>
                    <TableCell className="text-sm">
                      {TABLE_LABEL[l.table_name] || l.table_name}
                      <div className="font-mono text-xs text-slate-500">{l.action} · {l.record_id}</div>
                    </TableCell>
                    <TableCell className="space-y-0.5 font-mono text-xs">
                      {(l.changed_fields || []).map((f) => (
                        <div key={f}>
                          <span className="text-slate-500">{f}: </span>
                          {l.old_values && <del className="rounded bg-red-100 px-1 text-red-700">{show(l.old_values[f])}</del>}
                          {l.old_values && l.new_values && ' → '}
                          {l.new_values && <ins className="rounded bg-emerald-100 px-1 text-emerald-800 no-underline">{show(l.new_values[f])}</ins>}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-sm">{l.reason || '–'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </div>
  );
};

export default AuditLogs;
