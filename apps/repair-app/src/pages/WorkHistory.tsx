import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card, CardContent } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { TicketTable, type TicketRow } from './AssetHistory';

const WorkHistory: React.FC = () => {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ rows: TicketRow[]; total: number; totalPages: number }>({ rows: [], total: 0, totalPages: 1 });

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/repair-work-history', { params: { q, page, page_size: 30 } })
        .then((r) => setList({ rows: r.data.data, total: r.data.total, totalPages: r.data.total_pages }))
        .catch((err) => toast({ title: errorMessage(err, 'โหลดประวัติการทำงานไม่สำเร็จ'), variant: 'destructive' }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ประวัติการทำงาน</h1>
        <p className="text-sm text-slate-500">ใบซ่อมที่คุณรับผิดชอบ ร่วมซ่อม หรือดำเนินการ กดเลขใบซ่อมเพื่อดูขั้นตอนการซ่อม</p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="เลขใบ / ชื่อสิ่งของ / อาการ / รหัสครุภัณฑ์" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
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
    </div>
  );
};

export default WorkHistory;
