import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { ASSET_STATUS_LABEL, ASSET_TYPE_LABEL, CLOSE_RESULT_LABEL, type AssetType } from '../lib/repair';
import { fmtDateTimeTH, fmtMoney } from '../lib/format';
import { StatusPill } from '../components/RepairBadges';

interface AssetRow { asset_id: number; asset_code: string; name: string; status: string; asset_type: AssetType; open_ticket_no: string | null }

interface HistoryData {
  asset: { asset_id: number; asset_code: string; name: string; department_name: string | null; status: string;
           purchase_price: string | null; purchase_date: string | null; asset_type: AssetType };
  summary: { repair_count: number; repair_count_12m: number; downtime_days: string | number; avg_score: string | null; mtbf_days: number | null };
  replace_suggestion: { reason: string } | null;
  tickets: { ticket_id: number; ticket_no: string; title: string; description: string | null; status: string;
             close_result: string | null; created_date: string; assignee_name: string | null; score: number | null }[];
}

const AssetHistory: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [q, setQ] = useState('');
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/repair-assets', { params: { q } }).then((r) => setAssets(r.data.data)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setData(null);
    if (!id) return;
    api.get(`/api/assets/${id}/repair-history`)
      .then((r) => setData(r.data.data))
      .catch((err) => toast({ title: errorMessage(err, 'โหลดประวัติไม่สำเร็จ'), variant: 'destructive' }));
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ประวัติการซ่อมรายเครื่อง</h1>
          <p className="text-sm text-slate-500">นับเฉพาะใบซ่อมที่มีรหัสครุภัณฑ์</p>
        </div>
        <div className="flex w-full max-w-md gap-2">
          <Input placeholder="ค้นหาครุภัณฑ์" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="h-10 min-w-0 flex-1 rounded-md border px-2 text-sm" value={id || ''} onChange={(e) => navigate(`/assets/${e.target.value}`)} aria-label="เลือกครุภัณฑ์">
            <option value="">— เลือกครุภัณฑ์ —</option>
            {assets.map((a) => <option key={a.asset_id} value={a.asset_id}>{a.asset_code} · {a.name}</option>)}
          </select>
        </div>
      </div>

      {!id && <Card><CardContent className="p-8 text-center text-slate-400">เลือกครุภัณฑ์เพื่อดูประวัติการซ่อม</CardContent></Card>}

      {data && (
        <>
          <div>
            <h2 className="text-xl font-semibold">{data.asset.name}</h2>
            <p className="font-mono text-sm text-slate-500">
              {data.asset.asset_code} · {ASSET_TYPE_LABEL[data.asset.asset_type]} · {data.asset.department_name || '-'}
              {data.asset.purchase_price && ` · ราคาซื้อ ${fmtMoney(data.asset.purchase_price)} บาท`}
              {' · '}สถานะ: {ASSET_STATUS_LABEL[data.asset.status] || data.asset.status}
            </p>
          </div>

          {data.replace_suggestion && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-900">ควรพิจารณาจำหน่าย</p>
                <p className="text-sm text-amber-900/80">{data.replace_suggestion.reason}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['ซ่อมทั้งหมด', data.summary.repair_count],
              ['ใน 12 เดือน', data.summary.repair_count_12m],
              ['วันที่ใช้งานไม่ได้', data.summary.downtime_days ?? 0],
              ['วันเฉลี่ยระหว่างการเสีย (MTBF)', data.summary.mtbf_days ?? '–'],
            ].map(([label, v]) => (
              <Card key={label as string}><CardContent className="p-4">
                <p className="text-2xl font-bold tabular-nums">{v}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </CardContent></Card>
            ))}
          </div>
          <p className="text-xs text-slate-500">ค่าซ่อมสะสมจะแสดงเมื่อเปิดใช้ส่วนอะไหล่และซ่อมภายนอก (Phase 2)</p>

          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader className="bg-slate-100">
                  <TableRow>
                    <TableHead>เลขใบซ่อม</TableHead><TableHead>วันที่แจ้ง</TableHead><TableHead>อาการ</TableHead>
                    <TableHead>สถานะ</TableHead><TableHead>ผล</TableHead><TableHead>ช่าง</TableHead><TableHead>คะแนน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tickets.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">ยังไม่เคยซ่อม</TableCell></TableRow>
                  )}
                  {data.tickets.map((t) => (
                    <TableRow key={t.ticket_id}>
                      <TableCell className="font-mono text-xs"><Link to={`/repairs/${t.ticket_id}`} className="text-teal-700 hover:underline">{t.ticket_no}</Link></TableCell>
                      <TableCell className="text-xs">{fmtDateTimeTH(t.created_date)}</TableCell>
                      <TableCell>{t.description || t.title}</TableCell>
                      <TableCell><StatusPill status={t.status} /></TableCell>
                      <TableCell className="text-sm">{t.close_result ? CLOSE_RESULT_LABEL[t.close_result] : '–'}</TableCell>
                      <TableCell className="text-sm">{t.assignee_name || '–'}</TableCell>
                      <TableCell className="text-amber-500">{t.score ? '★'.repeat(t.score) : '–'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent></Card>
        </>
      )}
    </div>
  );
};

export default AssetHistory;
