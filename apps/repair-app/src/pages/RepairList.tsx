import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Card, CardContent } from '@repo/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import { cn } from '@repo/ui/utils';
import api, { errorMessage } from '../lib/api';
import { ASSET_TYPE_LABEL, URGENCY_LABEL, slaLevel, type AssetType } from '../lib/repair';
import { fmtDateTimeTH } from '../lib/format';
import { SlaBadge, StatusPill } from '../components/RepairBadges';
import { useAuth } from '../contexts/AuthContext';

interface Row {
  ticket_id: number;
  ticket_no: string;
  asset_type: AssetType;
  asset_code_snapshot: string | null;
  title: string;
  asset_department_snapshot: string | null;
  urgency: string;
  status: string;
  is_warranty: boolean;
  created_date: string;
  requester_name: string;
  assignee_name: string | null;
  hours_in_status: number;
  warn_after_hours: number | null;
}

// สถานะที่พัสดุต้องดำเนินการ
const SUPPLY_STATUSES = 'WAIT_PART,PART_APPROVAL,PART_PURCHASING,WAIT_EXTERNAL,EXT_APPROVAL,EXT_SENT';

const BASE_TABS = [
  { key: 'open', label: 'งานที่ยังไม่ปิด' },
  { key: 'mine', label: 'งานของฉัน' },
  { key: 'NEW', label: 'รอรับงาน' },
  { key: 'all', label: 'ทั้งหมด' },
];

const RepairList: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const isSupply = hasPermission('repair.supply');
  const TABS = isSupply ? [{ key: 'supply', label: 'งานพัสดุ' }, ...BASE_TABS] : BASE_TABS;
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState(isSupply ? 'supply' : 'open');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { q };
      if (type) params.asset_type = type;
      if (tab === 'open') params.status = 'open';
      if (tab === 'NEW') params.status = 'NEW';
      if (tab === 'supply') params.status = SUPPLY_STATUSES;
      if (tab === 'mine') { params.mine = '1'; params.status = 'open'; }
      const res = await api.get('/api/repairs', { params });
      setRows(res.data.data);
    } catch (err) {
      toast({ title: errorMessage(err, 'โหลดข้อมูลไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [tab, type, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const stats = useMemo(() => {
    const open = rows.filter((r) => !['CLOSED', 'CANCELLED'].includes(r.status));
    const lv = (r: Row) => slaLevel(r.hours_in_status, r.warn_after_hours);
    return {
      open: open.length,
      over: open.filter((r) => lv(r) === 'over').length,
      near: open.filter((r) => lv(r) === 'near').length,
      waitAccept: open.filter((r) => r.status === 'DONE').length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">งานซ่อม</h1>
          <p className="text-sm text-slate-500">เรียงงานที่ค้างนานเทียบกับเวลาที่กำหนดไว้บนสุด</p>
        </div>
        <Button onClick={() => navigate('/repairs/new')} className="bg-teal-700 hover:bg-teal-800">
          <Plus className="mr-2 h-4 w-4" />
          แจ้งซ่อม
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['งานที่แสดงและยังไม่ปิด', stats.open, ''],
          ['เกินเวลาที่กำหนด', stats.over, 'text-red-600'],
          ['ใกล้ครบเวลา', stats.near, 'text-amber-600'],
          ['รอผู้แจ้งตรวจรับ', stats.waitAccept, ''],
        ].map(([label, n, cls]) => (
          <Card key={label as string}>
            <CardContent className="p-4">
              <p className={cn('text-2xl font-bold tabular-nums', cls as string)}>{n}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  tab === t.key ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                {t.label}
              </button>
            ))}
            <div className="flex-1" />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border px-2 text-sm"
              aria-label="ประเภทงาน"
            >
              <option value="">ทุกประเภทที่มีสิทธิ์</option>
              {Object.entries(ASSET_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="เลขใบซ่อม / ชื่อ / รหัสครุภัณฑ์" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-slate-100">
                <TableRow>
                  <TableHead className="w-28">เลขใบซ่อม</TableHead>
                  <TableHead>ครุภัณฑ์ / อาการ</TableHead>
                  <TableHead className="w-32">ประเภท</TableHead>
                  <TableHead className="w-40">สถานะ</TableHead>
                  <TableHead className="w-56">SLA</TableHead>
                  <TableHead className="w-36">ช่าง</TableHead>
                  <TableHead className="w-36">แจ้งเมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">กำลังโหลด...</TableCell></TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">ไม่พบใบซ่อม</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.ticket_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/repairs/${r.ticket_id}`)}>
                    <TableCell className="font-mono text-xs">{r.ticket_no}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.title}</div>
                      <div className="font-mono text-xs text-slate-500">
                        {r.asset_code_snapshot || 'ไม่มีรหัสครุภัณฑ์'}
                        {r.asset_department_snapshot && ` · ${r.asset_department_snapshot}`}
                        {r.urgency !== 'NORMAL' && ` · ด่วน: ${URGENCY_LABEL[r.urgency]}`}
                      </div>
                    </TableCell>
                    <TableCell>{ASSET_TYPE_LABEL[r.asset_type]}</TableCell>
                    <TableCell><StatusPill status={r.status} warranty={r.is_warranty} /></TableCell>
                    <TableCell>
                      {['CLOSED', 'CANCELLED'].includes(r.status)
                        ? <span className="text-xs text-slate-400">–</span>
                        : <SlaBadge hours={r.hours_in_status} warn={r.warn_after_hours} />}
                    </TableCell>
                    <TableCell className="text-sm">{r.assignee_name || '–'}</TableCell>
                    <TableCell className="text-xs text-slate-500">{fmtDateTimeTH(r.created_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RepairList;
