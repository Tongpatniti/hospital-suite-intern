import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@repo/ui/button';
import { Label } from '@repo/ui/label';
import { Textarea } from '@repo/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/dialog';
import { toast } from '@repo/ui/use-toast';
import { cn } from '@repo/ui/utils';
import api, { errorMessage } from '../lib/api';
import {
  ASSET_STATUS_LABEL,
  ASSET_TYPE_LABEL,
  CLOSE_RESULT_LABEL,
  EVENT_LABEL,
  STATUS_LABEL,
  URGENCY_LABEL,
  fmtHours,
  type AssetType,
} from '../lib/repair';
import { fmtDateTimeTH } from '../lib/format';
import { StatusPill } from '../components/RepairBadges';

interface History {
  history_id: number;
  from_status: string | null;
  to_status: string;
  remark: string | null;
  metadata: { event?: string; score?: number; close_result?: string } | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface Ticket {
  ticket_id: number;
  ticket_no: string;
  asset_type: AssetType;
  asset_id: number | null;
  asset_code_snapshot: string | null;
  asset_name_snapshot: string | null;
  serial_number_snapshot: string | null;
  asset_department_snapshot: string | null;
  custodian_name_snapshot: string | null;
  location_snapshot: string | null;
  asset_current_status: string | null;
  title: string;
  description: string | null;
  urgency: string;
  status: string;
  is_warranty: boolean;
  requester_name: string;
  assignee_name: string | null;
  duplicate_of_ticket_no: string | null;
  duplicate_reason: string | null;
  reopen_count: number;
  created_date: string;
  history: History[];
  watchers: { person_id: number; person_name: string; source: string; note: string | null }[];
  sla_alerts: { alert_id: number; level: number; status: string; hours_overdue: string; sent_at: string; recipients: number[] }[];
  evaluation: { score: number; comment: string | null } | null;
  previous_repairs: { ticket_id: number; ticket_no: string; title: string; description: string | null; created_date: string; status: string }[];
  allowed_transitions: { code: string; label: string }[];
  is_watching: boolean;
}

type TimelineItem =
  | { kind: 'history'; at: string; h: History }
  | { kind: 'alert'; at: string; a: Ticket['sla_alerts'][number] };

const RepairDetail: React.FC = () => {
  const { id } = useParams();
  const [t, setT] = useState<Ticket | null>(null);
  const [action, setAction] = useState<{ code: string; label: string } | null>(null);
  const [remark, setRemark] = useState('');
  const [score, setScore] = useState(5);
  const [closeResult, setCloseResult] = useState('REPAIRED');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/repairs/${id}`);
      setT(res.data.data);
    } catch (err) {
      toast({ title: errorMessage(err, 'โหลดใบซ่อมไม่สำเร็จ'), variant: 'destructive' });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const openAction = (a: { code: string; label: string }) => {
    setAction(a);
    setRemark('');
    setScore(5);
    setCloseResult('REPAIRED');
  };

  const submitAction = async () => {
    if (!action || !t) return;
    setSaving(true);
    try {
      await api.patch(`/api/repairs/${t.ticket_id}/status`, {
        to_status: action.code,
        remark,
        score: action.code === 'CLOSED' ? score : undefined,
        close_result: action.code === 'CLOSED' ? closeResult : undefined,
      });
      toast({ title: `เปลี่ยนสถานะเป็น "${STATUS_LABEL[action.code]}" แล้ว` });
      setAction(null);
      load();
    } catch (err) {
      toast({ title: errorMessage(err, 'เปลี่ยนสถานะไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleWatch = async () => {
    if (!t) return;
    try {
      if (t.is_watching) await api.delete(`/api/repairs/${t.ticket_id}/watchers/me`);
      else await api.post(`/api/repairs/${t.ticket_id}/watchers`, { source: 'MANUAL' });
      load();
    } catch (err) {
      toast({ title: errorMessage(err, 'ทำรายการไม่สำเร็จ'), variant: 'destructive' });
    }
  };

  if (!t) return <p className="text-slate-400">กำลังโหลด...</p>;

  const timeline: TimelineItem[] = [
    ...t.history.map((h) => ({ kind: 'history' as const, at: h.changed_at, h })),
    ...t.sla_alerts.map((a) => ({ kind: 'alert' as const, at: a.sent_at, a })),
  ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

  const needRemark = ['CANCELLED', 'DONE'].includes(action?.code || '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-500">{t.ticket_no}</p>
          <h1 className="text-2xl font-bold text-slate-800">{t.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusPill status={t.status} warranty={t.is_warranty} />
            <span>{ASSET_TYPE_LABEL[t.asset_type]}</span>
            <span>· ความเร่งด่วน {URGENCY_LABEL[t.urgency]}</span>
            {t.reopen_count > 0 && <span>· เปิดซ้ำ {t.reopen_count} ครั้ง</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={toggleWatch}>{t.is_watching ? 'เลิกติดตาม' : 'ติดตามใบนี้'}</Button>
          {t.allowed_transitions.map((a) => (
            <Button
              key={a.code}
              variant={a.code === 'CANCELLED' ? 'outline' : 'default'}
              className={a.code === 'CANCELLED' ? 'text-red-600' : 'bg-teal-700 hover:bg-teal-800'}
              onClick={() => openAction(a)}
            >
              {a.code === 'IN_PROGRESS' && t.status === 'CLOSED' ? 'เปิดงานอีกครั้ง' : a.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {timeline.map((item) => {
                if (item.kind === 'alert') {
                  const a = item.a;
                  return (
                    <li key={`a${a.alert_id}`} className="relative border-l-2 border-red-200 pl-4">
                      <span className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-red-500" />
                      <p className="font-semibold text-red-700">
                        {a.level === 2 ? 'ส่งต่อหัวหน้า (งานค้างเกินเวลา)' : 'แจ้งเตือนงานค้างเกินเวลา'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtDateTimeTH(a.sent_at)} · "{STATUS_LABEL[a.status]}" เกินกำหนด {fmtHours(Number(a.hours_overdue))} · ส่งถึง {a.recipients.length} คน
                      </p>
                    </li>
                  );
                }
                const h = item.h;
                const event = h.metadata?.event;
                const isSub = h.from_status === h.to_status;
                return (
                  <li key={h.history_id} className="relative border-l-2 border-slate-200 pl-4">
                    <span className={cn('absolute -left-[7px] top-1.5 h-3 w-3 rounded-full', isSub ? 'border-2 border-teal-600 bg-white' : 'bg-teal-600')} />
                    <p className="font-semibold">{event ? EVENT_LABEL[event] || STATUS_LABEL[h.to_status] : STATUS_LABEL[h.to_status]}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDateTimeTH(h.changed_at)} · {h.changed_by_name || '-'}
                      {h.metadata?.score && ` · ให้คะแนน ${'★'.repeat(h.metadata.score)}`}
                      {h.metadata?.close_result && ` · ${CLOSE_RESULT_LABEL[h.metadata.close_result]}`}
                    </p>
                    {h.remark && <p className="mt-1 text-sm text-slate-700">{h.remark}</p>}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">ข้อมูลครุภัณฑ์ ณ วันที่แจ้ง</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-500">รหัส</dt><dd className="font-mono">{t.asset_code_snapshot || 'ไม่มีรหัสครุภัณฑ์'}</dd>
                <dt className="text-slate-500">Serial</dt><dd className="font-mono">{t.serial_number_snapshot || '-'}</dd>
                <dt className="text-slate-500">แผนก</dt><dd>{t.asset_department_snapshot || '-'}</dd>
                <dt className="text-slate-500">ผู้ดูแล</dt><dd>{t.custodian_name_snapshot || '-'}</dd>
                <dt className="text-slate-500">สถานที่</dt><dd>{t.location_snapshot || '-'}</dd>
                <dt className="text-slate-500">ผู้แจ้ง</dt><dd>{t.requester_name}</dd>
                <dt className="text-slate-500">ช่าง</dt><dd>{t.assignee_name || '-'}</dd>
                {t.asset_id && (
                  <>
                    <dt className="text-slate-500">สถานะในทะเบียน</dt>
                    <dd>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs',
                        t.asset_current_status === 'REPAIRING' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
                        {ASSET_STATUS_LABEL[t.asset_current_status || ''] || t.asset_current_status}
                      </span>
                    </dd>
                  </>
                )}
              </dl>
              {t.duplicate_of_ticket_no && (
                <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                  แจ้งซ้ำกับ {t.duplicate_of_ticket_no} · เหตุผล: {t.duplicate_reason}
                </p>
              )}
              {t.asset_id && (
                <Link to={`/assets/${t.asset_id}`} className="mt-3 inline-block text-sm text-teal-700 hover:underline">
                  ดูประวัติซ่อมของเครื่องนี้ →
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">ผู้ติดตาม ({t.watchers.length})</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {t.watchers.length === 0 && <p className="text-slate-400">ยังไม่มีผู้ติดตาม</p>}
              {t.watchers.map((w) => (
                <p key={w.person_id}>
                  {w.person_name}
                  {w.source === 'DUPLICATE' && <span className="text-xs text-amber-700"> · แจ้งปัญหาเดียวกัน</span>}
                  {w.note && <span className="text-xs text-slate-500"> · "{w.note}"</span>}
                </p>
              ))}
            </CardContent>
          </Card>

          {t.previous_repairs.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">ซ่อมครั้งก่อนของเครื่องนี้</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {t.previous_repairs.map((p) => (
                  <Link key={p.ticket_id} to={`/repairs/${p.ticket_id}`} className="block hover:text-teal-700">
                    <span className="font-mono text-xs">{p.ticket_no}</span> · {fmtDateTimeTH(p.created_date)} · {p.description || p.title}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{action?.label}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {action?.code === 'CLOSED' && (
              <>
                <div className="space-y-1">
                  <Label>ความพึงพอใจ</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setScore(n)} className={cn('text-2xl', n <= score ? 'text-amber-500' : 'text-slate-300')} aria-label={`${n} ดาว`}>★</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="closeResult">ผลการซ่อม</Label>
                  <select id="closeResult" className="h-10 w-full rounded-md border px-2 text-sm" value={closeResult} onChange={(e) => setCloseResult(e.target.value)}>
                    {Object.entries(CLOSE_RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor="remark">{needRemark ? 'รายละเอียด / เหตุผล (บังคับ)' : 'หมายเหตุ'}</Label>
              <Textarea id="remark" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
            {action?.code === 'ACCEPTED' && t.asset_id && (
              <p className="text-xs text-slate-500">เมื่อรับงาน ทะเบียนครุภัณฑ์จะเปลี่ยนเป็น "อยู่ระหว่างซ่อม" จนกว่าจะปิดงาน</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={submitAction} disabled={saving || (needRemark && !remark.trim())} className="bg-teal-700 hover:bg-teal-800">
              {saving ? 'กำลังบันทึก...' : 'ยืนยัน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RepairDetail;
