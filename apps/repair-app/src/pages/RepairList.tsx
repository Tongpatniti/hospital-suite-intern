import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@repo/ui/input';
import { Card, CardContent } from '@repo/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import { cn } from '@repo/ui/utils';
import api, { errorMessage } from '../lib/api';
import {
  ASSET_TYPE_LABEL,
  STATUS_LABEL,
  SUPPLY_STATUSES,
  TYPE_LIST_LABEL,
  URGENCY_LABEL,
  canRequestType,
  hasAnyTech,
  isAdmin,
  slaLevel,
  type AssetType,
} from '../lib/repair';
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
  work_days: number | null;
}

interface Tab { key: string; label: string; params: Record<string, string> }

type SortKey = 'ticket_no' | 'created_date' | 'status' | 'sla';
interface Sort { key: SortKey; dir: 'asc' | 'desc' }

const TYPES = Object.keys(ASSET_TYPE_LABEL) as AssetType[];

const RepairList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const type = (searchParams.get('type') || '') as '' | AssetType;

  const admin = isAdmin(hasPermission);
  const isSupply = admin || hasPermission('repair.supply');
  const isTech = !admin && hasAnyTech(hasPermission);
  const isRequester = !admin && TYPES.some((t) => canRequestType(hasPermission, t));

  const tabs: Tab[] = useMemo(() => {
    if (admin) {
      return [
        { key: 'open', label: 'งานที่ยังไม่ปิด', params: { status: 'open' } },
        { key: 'NEW', label: 'รอรับงาน', params: { status: 'NEW' } },
        { key: 'DONE', label: 'รอตรวจรับ', params: { status: 'DONE' } },
        { key: 'supply', label: 'งานพัสดุ', params: { status: SUPPLY_STATUSES.join(',') } },
        { key: 'CLOSED', label: 'รายการที่เสร็จสิ้น', params: { status: 'CLOSED' } },
        { key: 'CANCELLED', label: 'ยกเลิก/ปฏิเสธ', params: { status: 'CANCELLED' } },
        { key: 'all', label: 'ทั้งหมด', params: {} },
      ];
    }
    if (hasPermission('repair.po.approve') && !isRequester && !isTech && !isSupply) {
      return [{ key: 'PO_PENDING', label: 'รออนุมัติ PO', params: { status: 'PO_PENDING' } }];
    }
    const newTab: Tab = { key: 'NEW', label: 'รอช่างรับงาน', params: { status: 'NEW' } };
    const list: Tab[] = isTech ? [newTab] : [];
    if (isRequester) list.push({ key: 'my_requests', label: 'แจ้งซ่อมของฉัน', params: { scope: 'my_requests', status: 'open' } });
    if (isTech) list.push({ key: 'my_tasks', label: 'งานที่ฉันรับผิดชอบ', params: { scope: 'my_tasks', status: 'open' } });
    if (isSupply) {
      list.push({ key: 'supply', label: 'งานพัสดุ', params: { status: SUPPLY_STATUSES.join(',') } });
      list.push({ key: 'handled', label: 'งานที่ฉันดำเนินการ', params: { scope: 'handled' } });
    }
    if (!isTech) list.push(newTab);
    if (isRequester) list.push({ key: 'DONE', label: 'รอตรวจรับ', params: { status: 'DONE' } });
    if (isTech || isSupply) list.push({ key: 'open', label: 'งานที่ยังไม่ปิด', params: { status: 'open' } });
    list.push({ key: 'CLOSED', label: 'รายการที่เสร็จสิ้น', params: { status: 'CLOSED' } });
    list.push({ key: 'CANCELLED', label: 'ยกเลิก/ปฏิเสธ', params: { status: 'CANCELLED' } });
    list.push({ key: 'all', label: 'ทั้งหมด', params: {} });
    return list;
  }, [admin, isRequester, isTech, isSupply, hasPermission]);

  const [tab, setTab] = useState(tabs[0].key);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = tabs.find((t) => t.key === activeTab) || tabs[0];
      const params: Record<string, string> = { ...current.params, q };
      if (type) params.asset_type = type;
      if (view === 'all') params.view = 'all';
      const res = await api.get('/api/repairs', { params });
      setRows(res.data.data);
    } catch (err) {
      toast({ title: errorMessage(err, 'โหลดข้อมูลไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [tabs, activeTab, type, view, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const [sort, setSort] = useState<Sort | null>(null);

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };

  const sortIcon = (key: SortKey) => (sort?.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const value = (r: Row): number | string => {
      switch (sort.key) {
        case 'ticket_no': return r.ticket_no;
        case 'created_date': return new Date(r.created_date).getTime();
        case 'status': return STATUS_LABEL[r.status] || r.status;
        case 'sla': return r.warn_after_hours ? r.hours_in_status / r.warn_after_hours : -1;
      }
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
      return sort.dir === 'asc' ? c : -c;
    });
    return copy;
  }, [rows, sort]);

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
          <h1 className="text-2xl font-bold text-slate-800">
            {type ? `รายการแจ้งซ่อม${TYPE_LIST_LABEL[type]}` : 'รายการแจ้งซ่อม'}
          </h1>
          <p className="text-sm text-slate-500">เรียงงานที่ค้างนานเทียบกับเวลาที่กำหนดไว้บนสุด</p>
        </div>
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
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  activeTab === t.key ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                {t.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setView((v) => (v === 'mine' ? 'all' : 'mine'))}
              className="rounded-md border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              title="สลับการจัดลำดับรายการ"
            >
              {view === 'mine' ? 'แสดงทั้งหมด (ไม่จัดลำดับของฉันก่อน)' : 'จัดลำดับ: ของฉันก่อน'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={type}
              disabled
              className="h-9 cursor-not-allowed rounded-md border bg-slate-100 px-2 text-sm text-slate-500"
              aria-label="ประเภทงาน"
            >
              <option value="">ทุกประเภท</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>{ASSET_TYPE_LABEL[k]}</option>
              ))}
            </select>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="เลขใบซ่อม / ชื่อ / รหัสครุภัณฑ์" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[860px]">
              <TableHeader className="bg-slate-100">
                <TableRow>
                  <TableHead className="w-28 whitespace-nowrap"><button type="button" onClick={() => toggleSort('ticket_no')} className="font-semibold hover:text-teal-800">เลขใบซ่อม{sortIcon('ticket_no')}</button></TableHead>
                  <TableHead className="whitespace-nowrap">ครุภัณฑ์ / อาการ</TableHead>
                  <TableHead className="w-24 whitespace-nowrap">ประเภท</TableHead>
                  <TableHead className="whitespace-nowrap"><button type="button" onClick={() => toggleSort('status')} className="font-semibold hover:text-teal-800">สถานะ{sortIcon('status')}</button></TableHead>
                  <TableHead className="whitespace-nowrap"><button type="button" onClick={() => toggleSort('sla')} className="font-semibold hover:text-teal-800">SLA{sortIcon('sla')}</button></TableHead>
                  <TableHead className="whitespace-nowrap">ช่าง</TableHead>
                  <TableHead className="w-24 whitespace-nowrap text-center">ระยะเวลา (วัน)</TableHead>
                  <TableHead className="whitespace-nowrap"><button type="button" onClick={() => toggleSort('created_date')} className="font-semibold hover:text-teal-800">แจ้งเมื่อ{sortIcon('created_date')}</button></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-400">กำลังโหลด...</TableCell></TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-400">ไม่พบใบซ่อม</TableCell></TableRow>
                )}
                {sortedRows.map((r) => (
                  <TableRow key={r.ticket_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/repairs/${r.ticket_id}`)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs align-middle">{r.ticket_no}</TableCell>
                    <TableCell className="min-w-[18rem] align-middle">
                      <div className="max-w-[26rem] truncate font-medium" title={r.title}>{r.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 font-mono text-xs text-slate-500">
                        <span className="whitespace-nowrap">{r.asset_code_snapshot || 'ไม่มีรหัสครุภัณฑ์'}</span>
                        {r.asset_department_snapshot && <span className="truncate">· {r.asset_department_snapshot}</span>}
                        {r.urgency !== 'NORMAL' && <span className="whitespace-nowrap">· ด่วน: {URGENCY_LABEL[r.urgency]}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-middle">
                      <div>{ASSET_TYPE_LABEL[r.asset_type]}</div>
                    </TableCell>
                    <TableCell className="align-middle"><StatusPill status={r.status} warranty={r.is_warranty} /></TableCell>
                    <TableCell className="whitespace-nowrap align-middle">
                      {['CLOSED', 'CANCELLED'].includes(r.status)
                        ? <span className="text-xs text-slate-400">–</span>
                        : <SlaBadge hours={r.hours_in_status} warn={r.warn_after_hours} />}
                    </TableCell>
                    <TableCell className="max-w-[11rem] truncate align-middle text-sm" title={r.assignee_name || undefined}>{r.assignee_name || '–'}</TableCell>
                    <TableCell className="text-center tabular-nums align-middle text-sm">{r.work_days ?? '–'}</TableCell>
                    <TableCell className="whitespace-nowrap align-middle text-xs text-slate-500">{fmtDateTimeTH(r.created_date)}</TableCell>
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
