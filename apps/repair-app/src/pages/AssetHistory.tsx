import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Search } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card, CardContent } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import { cn } from '@repo/ui/utils';
import api, { errorMessage } from '../lib/api';
import { ASSET_STATUS_LABEL, ASSET_TYPE_LABEL, CLOSE_RESULT_LABEL, type AssetType } from '../lib/repair';
import { fmtDateTimeTH, fmtMoney } from '../lib/format';
import { StatusPill } from '../components/RepairBadges';

interface AssetRow { asset_id: number; asset_code: string; name: string; department_name: string | null; asset_type: AssetType }

interface TicketRow {
  ticket_id: number; ticket_no: string; asset_type?: AssetType; asset_id?: number | null; asset_code_snapshot?: string | null;
  title: string; description: string | null; asset_department_snapshot?: string | null; status: string;
  close_result: string | null; created_date: string; assignee_name: string | null; score: number | null; total_cost: number | null;
}

interface HistoryData {
  asset: { asset_id: number; asset_code: string; name: string; department_name: string | null; status: string;
           purchase_price: string | null; asset_type: AssetType };
  summary: { repair_count: number; repair_count_12m: number; downtime_days: string | number; mtbf_days: number | null; total_cost: number };
  replace_suggestion: { reason: string } | null;
  tickets: TicketRow[];
}

interface StatRow {
  asset_id: number; asset_code: string; name: string; department_name: string | null; asset_type: AssetType;
  repair_count: number; repair_count_12m: number; cancelled_count: number; last_repair_date: string | null; total_cost: number;
}

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'ทุกประเภท' },
  { key: 'GENERAL', label: 'ทั่วไป' },
  { key: 'COMPUTER', label: 'คอมพิวเตอร์' },
  { key: 'MEDICAL', label: 'เครื่องมือแพทย์' },
];

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'yes', label: 'มีรหัสครุภัณฑ์' },
  { key: 'no', label: 'ไม่มีรหัสครุภัณฑ์' },
];

function TicketTable({ rows, showAsset }: { rows: TicketRow[]; showAsset?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[900px]">
        <TableHeader className="bg-slate-100">
          <TableRow>
            <TableHead className="w-28">เลขใบซ่อม</TableHead>
            <TableHead className="w-36">วันที่แจ้ง</TableHead>
            {showAsset && <TableHead className="w-56">ครุภัณฑ์ / สิ่งของ</TableHead>}
            <TableHead>อาการ</TableHead>
            <TableHead className="w-36">สถานะ</TableHead>
            <TableHead className="w-32">ผล</TableHead>
            <TableHead className="w-28 text-right">ค่าใช้จ่าย</TableHead>
            <TableHead className="w-20">คะแนน</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={showAsset ? 8 : 7} className="py-8 text-center text-slate-400">ไม่พบประวัติการซ่อม</TableCell></TableRow>
          )}
          {rows.map((t) => (
            <TableRow key={t.ticket_id}>
              <TableCell className="font-mono text-xs"><Link to={`/repairs/${t.ticket_id}`} className="text-teal-700 hover:underline">{t.ticket_no}</Link></TableCell>
              <TableCell className="text-xs">{fmtDateTimeTH(t.created_date)}</TableCell>
              {showAsset && (
                <TableCell>
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-slate-500">
                    {t.asset_id
                      ? <Link to={`/assets/${t.asset_id}`} className="font-mono text-teal-700 hover:underline">{t.asset_code_snapshot}</Link>
                      : <span className="rounded bg-slate-100 px-1.5">ไม่มีรหัสครุภัณฑ์</span>}
                    {t.asset_department_snapshot && ` · ${t.asset_department_snapshot}`}
                  </div>
                </TableCell>
              )}
              <TableCell className="text-sm">{t.description || (showAsset ? '–' : t.title)}</TableCell>
              <TableCell><StatusPill status={t.status} /></TableCell>
              <TableCell className="text-sm">{t.close_result ? CLOSE_RESULT_LABEL[t.close_result] : '–'}</TableCell>
              <TableCell className="text-right tabular-nums text-sm">{t.total_cost ? fmtMoney(t.total_cost) : '–'}</TableCell>
              <TableCell className="text-amber-500">{t.score ? '★'.repeat(t.score) : '–'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const AssetHistory: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // ตัวเลือกครุภัณฑ์
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetQ, setAssetQ] = useState('');

  // ภาพรวมทุกใบ
  const [filter, setFilter] = useState('all');
  const [assetType, setAssetType] = useState('');
  const [stats, setStats] = useState<StatRow[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ rows: TicketRow[]; total: number; totalPages: number }>({ rows: [], total: 0, totalPages: 1 });

  // รายเครื่อง
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/repair-assets', { params: { q: assetQ } }).then((r) => setAssets(r.data.data)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [assetQ]);

  useEffect(() => {
    if (id) return;
    const t = setTimeout(() => {
      api.get('/api/repair-history', { params: { has_asset: filter, asset_type: assetType, q, page, page_size: 30 } })
        .then((r) => setList({ rows: r.data.data, total: r.data.total, totalPages: r.data.total_pages }))
        .catch((err) => toast({ title: errorMessage(err, 'โหลดประวัติไม่สำเร็จ'), variant: 'destructive' }));
    }, 250);
    return () => clearTimeout(t);
  }, [id, filter, assetType, q, page]);

  useEffect(() => {
    if (id || !showStats) return;
    const t = setTimeout(() => {
      api.get('/api/repair-asset-stats', { params: { asset_type: assetType } })
        .then((r) => setStats(r.data.data))
        .catch((err) => toast({ title: errorMessage(err, 'โหลดสถิติครุภัณฑ์ไม่สำเร็จ'), variant: 'destructive' }));
    }, 250);
    return () => clearTimeout(t);
  }, [id, assetType, showStats]);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/assets/${id}/repair-history`)
      .then((r) => setData(r.data.data))
      .catch((err) => toast({ title: errorMessage(err, 'โหลดประวัติไม่สำเร็จ'), variant: 'destructive' }));
  }, [id]);

  const current = id && data && String(data.asset.asset_id) === id ? data : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ประวัติการซ่อม</h1>
        <p className="text-sm text-slate-500">ดูทุกใบซ่อม ทั้งที่มีและไม่มีรหัสครุภัณฑ์ หรือเลือกครุภัณฑ์เพื่อดูสรุปรายเครื่อง</p>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label htmlFor="assetPick">ดูสรุปรายเครื่อง</Label>
          <div className="grid gap-2 md:grid-cols-[18rem_minmax(0,1fr)]">
            <Input id="assetQ" placeholder="ค้นหารหัสหรือชื่อครุภัณฑ์" value={assetQ} onChange={(e) => setAssetQ(e.target.value)} />
            <select
              id="assetPick"
              className="h-10 w-full min-w-0 rounded-md border px-3 text-sm"
              value={id || ''}
              onChange={(e) => navigate(e.target.value ? `/assets/${e.target.value}` : '/assets')}
            >
              <option value="">— ทุกใบซ่อม (ไม่เลือกเครื่อง) —</option>
              {assets.map((a) => (
                <option key={a.asset_id} value={a.asset_id}>
                  {a.asset_code} · {a.name} · {ASSET_TYPE_LABEL[a.asset_type]}{a.department_name ? ` · ${a.department_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {!id && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }}
                  className={cn('rounded-md px-3 py-1.5 text-sm', filter === f.key ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-50')}>
                  {f.label}
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex flex-wrap gap-1">
                {TYPE_FILTERS.map((f) => (
                  <button key={f.key} onClick={() => { setAssetType(f.key); setPage(1); }}
                    className={cn('rounded-md px-3 py-1.5 text-sm', assetType === f.key ? 'bg-teal-50 font-semibold text-teal-800' : 'text-slate-600 hover:bg-slate-50')}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" placeholder="เลขใบ / ชื่อสิ่งของ / อาการ / แผนก" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </div>
            </div>
            <div className="rounded-md border"><TicketTable rows={list.rows} showAsset /></div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{list.total.toLocaleString()} ใบ</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
                <span>หน้า {page} / {list.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= list.totalPages} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!id && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-800">สถิติการซ่อมรายครุภัณฑ์</h2>
                <p className="text-xs text-slate-500">นับทุกใบซ่อมของเครื่อง รวมใบที่ยกเลิก เรียงจากซ่อมมากที่สุด</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowStats((v) => !v)}>
                {showStats ? 'ซ่อนสถิติ' : 'แสดงสถิติ'}
              </Button>
            </div>
            {!showStats && <p className="text-sm text-slate-400">กดปุ่ม "แสดงสถิติ" เพื่อโหลดข้อมูล</p>}
            {showStats && (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[860px]">
                <TableHeader className="bg-slate-100">
                  <TableRow>
                    <TableHead className="w-36">รหัสครุภัณฑ์</TableHead>
                    <TableHead>ชื่อครุภัณฑ์</TableHead>
                    <TableHead className="w-32">ประเภท</TableHead>
                    <TableHead className="w-24 text-right">ซ่อมทั้งหมด</TableHead>
                    <TableHead className="w-24 text-right">ใน 12 เดือน</TableHead>
                    <TableHead className="w-24 text-right">ยกเลิก</TableHead>
                    <TableHead className="w-32 text-right">ค่าซ่อมสะสม</TableHead>
                    <TableHead className="w-36">ซ่อมล่าสุด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-400">ไม่มีข้อมูลครุภัณฑ์</TableCell></TableRow>
                  )}
                  {stats.map((s) => (
                    <TableRow key={s.asset_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/assets/${s.asset_id}`)}>
                      <TableCell className="font-mono text-xs">{s.asset_code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        {s.department_name && <div className="text-xs text-slate-500">{s.department_name}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{ASSET_TYPE_LABEL[s.asset_type]}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{s.repair_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.repair_count_12m}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.cancelled_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{s.total_cost ? fmtMoney(s.total_cost) : '–'}</TableCell>
                      <TableCell className="text-xs">{s.last_repair_date ? fmtDateTimeTH(s.last_repair_date) : '–'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {current && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">{current.asset.name}</h2>
              <p className="font-mono text-sm text-slate-500">
                {current.asset.asset_code} · {ASSET_TYPE_LABEL[current.asset.asset_type]} · {current.asset.department_name || '-'}
                {current.asset.purchase_price && ` · ราคาซื้อ ${fmtMoney(current.asset.purchase_price)} บาท`}
                {' · '}สถานะ: {ASSET_STATUS_LABEL[current.asset.status] || current.asset.status}
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate('/assets')}><ArrowLeft className="mr-1 h-4 w-4" /> ทุกใบซ่อม</Button>
          </div>

          {current.replace_suggestion && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-900">ควรพิจารณาจำหน่าย</p>
                <p className="text-sm text-amber-900/80">{current.replace_suggestion.reason}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['ซ่อมทั้งหมด (รวมยกเลิก)', current.summary.repair_count],
              ['ใน 12 เดือน', current.summary.repair_count_12m],
              ['ค่าซ่อมสะสม (บาท)', fmtMoney(current.summary.total_cost)],
              ['วันที่ใช้งานไม่ได้', current.summary.downtime_days ?? 0],
              ['วันเฉลี่ยระหว่างการเสีย', current.summary.mtbf_days ?? '–'],
            ].map(([label, v]) => (
              <Card key={label as string}><CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums">{v}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </CardContent></Card>
            ))}
          </div>

          <Card><CardContent className="p-0"><TicketTable rows={current.tickets} /></CardContent></Card>
        </>
      )}
    </div>
  );
};

export default AssetHistory;
