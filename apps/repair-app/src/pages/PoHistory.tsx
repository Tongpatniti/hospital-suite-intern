import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card, CardContent } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import { cn } from '@repo/ui/utils';
import api, { errorMessage } from '../lib/api';
import { fmtDateTimeTH } from '../lib/format';

interface PoRow {
  po_id: number;
  po_no: string;
  po_date: string | null;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decision_remark: string | null;
  ticket_id: number;
  ticket_no: string;
  title: string;
  asset_code_snapshot: string | null;
  decided_by_name: string | null;
}

const PO_STATUS_LABEL: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
};

const PO_STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

const PoHistory: React.FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ rows: PoRow[]; total: number; totalPages: number }>({ rows: [], total: 0, totalPages: 1 });

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/repair-po-history', { params: { q, page, page_size: 30 } })
        .then((r) => setList({ rows: r.data.data, total: r.data.total, totalPages: r.data.total_pages }))
        .catch((err) => toast({ title: errorMessage(err, 'โหลดประวัติการยื่น PO ไม่สำเร็จ'), variant: 'destructive' }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ประวัติการยื่น PO</h1>
        <p className="text-sm text-slate-500">ใบสั่งซื้อที่คุณยื่นขออนุมัติ กดเลขใบซ่อมเพื่อดูขั้นตอนการซ่อม</p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="เลขที่ PO / เลขใบซ่อม / ชื่อสิ่งของ" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[900px]">
              <TableHeader className="bg-slate-100">
                <TableRow>
                  <TableHead className="w-32 whitespace-nowrap">เลขที่ PO</TableHead>
                  <TableHead className="w-28 whitespace-nowrap">วันที่ PO</TableHead>
                  <TableHead className="w-28 whitespace-nowrap">ใบซ่อม</TableHead>
                  <TableHead className="whitespace-nowrap">ครุภัณฑ์ / สิ่งของ</TableHead>
                  <TableHead className="whitespace-nowrap">สถานะ PO</TableHead>
                  <TableHead className="whitespace-nowrap">ผู้อนุมัติ</TableHead>
                  <TableHead className="w-32 whitespace-nowrap">วันที่ยื่น</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">ไม่พบประวัติการยื่น PO</TableCell></TableRow>
                )}
                {list.rows.map((p) => (
                  <TableRow key={p.po_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/repairs/${p.ticket_id}`)}>
                    <TableCell className="whitespace-nowrap font-mono text-xs align-middle">{p.po_no}</TableCell>
                    <TableCell className="whitespace-nowrap align-middle text-xs text-slate-500">{p.po_date ? p.po_date.slice(0, 10) : '–'}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs align-middle">
                      <Link to={`/repairs/${p.ticket_id}`} onClick={(e) => e.stopPropagation()} className="text-teal-700 hover:underline">{p.ticket_no}</Link>
                    </TableCell>
                    <TableCell className="min-w-[16rem] align-middle">
                      <div className="max-w-[24rem] truncate font-medium" title={p.title}>{p.title}</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">{p.asset_code_snapshot || 'ไม่มีรหัสครุภัณฑ์'}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-middle">
                      <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', PO_STATUS_CLASS[p.status])}>
                        {PO_STATUS_LABEL[p.status] || p.status}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] align-middle text-sm">
                      <div className="truncate" title={p.decided_by_name || undefined}>{p.decided_by_name || '–'}</div>
                      {p.decision_remark && <div className="truncate text-xs text-slate-500" title={p.decision_remark}>{p.decision_remark}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-middle text-xs text-slate-500">{fmtDateTimeTH(p.requested_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{list.total.toLocaleString()} รายการ</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
              <span>หน้า {page} / {list.totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= list.totalPages} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PoHistory;
