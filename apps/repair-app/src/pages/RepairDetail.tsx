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
import { AttachmentGallery, AttachmentPicker, type Attachment } from '../components/Attachments';
import { uploadPrepared, type PreparedFile } from '../lib/upload';
import { useAuth } from '../contexts/AuthContext';
import { ExternalFields, ExternalSummary, PartsForm, PartsTable, type External, type Part } from '../components/StepForms';
import { emptyExternal, emptyPart, filledParts, partsReady, type ExternalForm, type PartRow } from '../lib/stepForms';

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
  attachments: Attachment[];
  requester_id: number;
  close_result: string | null;
  parts: Part[];
  externals: External[];
}

type ActionKind = 'confirm' | 'cancel' | 'done' | 'close' | 'sendBack' | 'parts' | 'extRequest' | 'extSend' | 'extReceive';

// ขั้นไหนต้องกรอกอะไรเพิ่ม — ที่เหลือมีแค่ปุ่มยืนยัน/ยกเลิก
function actionKind(from: string, to: string): ActionKind {
  if (to === 'CANCELLED') return 'cancel';
  if (to === 'DONE') return 'done';
  if (to === 'CLOSED') return 'close';
  if (to === 'IN_PROGRESS' && (from === 'DONE' || from === 'CLOSED')) return 'sendBack';
  if (to === 'WAIT_PART') return 'parts';
  if (to === 'WAIT_EXTERNAL') return 'extRequest';
  if (to === 'EXT_SENT') return 'extSend';
  if (to === 'EXT_RECEIVED') return 'extReceive';
  return 'confirm';
}

function actionLabel(from: string, to: string, fallback: string, isRequesterSide: boolean) {
  if (to === 'CANCELLED') return 'ยกเลิกใบซ่อม';
  if (to === 'IN_PROGRESS' && from === 'CLOSED') return 'เปิดงานอีกครั้ง';
  if (to === 'IN_PROGRESS' && from === 'DONE') return isRequesterSide ? 'ไม่ผ่าน ส่งกลับซ่อม' : 'ส่งกลับซ่อมอีกครั้ง';
  if (to === 'WAIT_PART') return 'สั่งซื้ออะไหล่';
  if (to === 'WAIT_EXTERNAL') return 'ส่งเรื่องซ่อมภายนอก';
  if (to === 'PART_APPROVAL') return 'พัสดุรับเรื่องอะไหล่';
  if (to === 'PART_PURCHASING') return 'อนุมัติ เริ่มจัดซื้อ';
  if (to === 'PART_ARRIVED') return 'อะไหล่ถึงคลังแล้ว';
  if (to === 'EXT_APPROVAL') return 'พัสดุรับเรื่องส่งซ่อม';
  if (to === 'EXT_SENT') return 'ส่งร้านภายนอกแล้ว';
  if (to === 'EXT_RECEIVED') return 'รับเครื่องคืนแล้ว';
  if (to === 'IN_PROGRESS' && from === 'PART_ARRIVED') return 'รับอะไหล่แล้ว ซ่อมต่อ';
  if (to === 'IN_PROGRESS' && from === 'EXT_RECEIVED') return 'ตรวจรับเครื่องแล้ว ซ่อมต่อ';
  if (to === 'IN_PROGRESS') return 'เริ่มดำเนินงาน';
  if (to === 'CLOSED') return 'ตรวจรับและปิดงาน';
  if (to === 'DONE') return 'ซ่อมเสร็จ';
  return fallback;
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
  const [stepFiles, setStepFiles] = useState<PreparedFile[]>([]);
  const [extraFiles, setExtraFiles] = useState<PreparedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [partRows, setPartRows] = useState<PartRow[]>([emptyPart()]);
  const [extForm, setExtForm] = useState<ExternalForm>(emptyExternal());
  const { user, hasPermission } = useAuth();
  const myId = Number(user?.id);

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
    setStepFiles([]);
    setPartRows([emptyPart()]);
    setExtForm(emptyExternal());
  };

  const submitAction = async () => {
    if (!action || !t) return;
    setSaving(true);
    let uploadedIds: number[] = []; // รูปของขั้นนี้
    const allUploaded: number[] = []; // ทุกไฟล์ที่อัปโหลดในรอบนี้ (ไว้ลบถ้าล้มเหลว)
    try {
      if (stepFiles.length > 0) {
        const up = await uploadPrepared(t.ticket_id, stepFiles, 'STATUS');
        uploadedIds = up.ids;
        allUploaded.push(...up.ids);
        if (up.errors.length > 0) throw new Error(up.errors.join('\n'));
      }
      // รูปของแต่ละรายการอะไหล่
      let parts: Record<string, unknown>[] | undefined;
      if (action.code === 'WAIT_PART') {
        parts = [];
        for (const r of filledParts(partRows)) {
          const up = await uploadPrepared(t.ticket_id, r.files, 'PART');
          allUploaded.push(...up.ids);
          if (up.errors.length > 0) throw new Error(up.errors.join('\n'));
          parts.push({
            part_name: r.part_name.trim(), part_no: r.part_no.trim(), qty: Number(r.qty), unit: r.unit.trim(),
            estimated_unit_price: r.estimated_unit_price === '' ? null : Number(r.estimated_unit_price), note: r.note.trim(),
            attachment_ids: up.ids,
          });
        }
      }
      await api.patch(`/api/repairs/${t.ticket_id}/status`, {
        to_status: action.code,
        remark,
        score: action.code === 'CLOSED' ? score : undefined,
        comment: action.code === 'CLOSED' ? remark : undefined,
        close_result: action.code === 'DONE' ? closeResult : undefined,
        attachment_ids: uploadedIds,
        parts,
        external: ['WAIT_EXTERNAL', 'EXT_SENT', 'EXT_RECEIVED'].includes(action.code)
          ? {
              ...extForm,
              sent_date: extForm.sent_date || null,
              return_date: extForm.return_date || null,
              actual_cost: extForm.actual_cost === '' ? null : Number(extForm.actual_cost),
            }
          : undefined,
      });
      toast({ title: `เปลี่ยนสถานะเป็น "${STATUS_LABEL[action.code]}" แล้ว` });
      setAction(null);
      load();
    } catch (err) {
      // เปลี่ยนสถานะไม่สำเร็จ — ลบไฟล์ที่เพิ่งอัปโหลดไว้สำหรับขั้นนี้ ไม่ให้ค้าง
      await Promise.all(allUploaded.map((id) => api.delete(`/api/repairs/${t.ticket_id}/attachments/${id}`).catch(() => undefined)));
      toast({ title: errorMessage(err, (err as Error).message || 'เปลี่ยนสถานะไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const uploadExtra = async () => {
    if (!t || extraFiles.length === 0) return;
    setUploading(true);
    const up = await uploadPrepared(t.ticket_id, extraFiles, 'TICKET');
    setUploading(false);
    if (up.errors.length) toast({ title: 'แนบไฟล์ไม่สำเร็จบางไฟล์', description: up.errors.join('\n'), variant: 'destructive' });
    else toast({ title: `แนบไฟล์ ${up.ids.length} ไฟล์แล้ว` });
    setExtraFiles([]);
    load();
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

  const kind: ActionKind = action ? actionKind(t.status, action.code) : 'confirm';
  const needRemark = kind === 'cancel' || kind === 'done' || kind === 'sendBack' || kind === 'extRequest';
  const canSubmit = !saving
    && (!needRemark || remark.trim() !== '')
    && (kind !== 'parts' || partsReady(partRows))
    && (kind !== 'extSend' || (extForm.vendor_name.trim() !== '' && extForm.sent_date !== ''))
    && (kind !== 'extReceive' || extForm.return_date !== '');
  const showFiles = kind === 'done' || kind === 'extRequest'; // อะไหล่แนบรูปแยกในแต่ละรายการ
  const isTechSide = hasPermission(`repair.${t.asset_type.toLowerCase()}.tech`) || hasPermission('repair.all');
  const isRequesterSide = t.requester_id === myId && !isTechSide;
  const label = (code: string, fallback: string) => actionLabel(t.status, code, fallback, isRequesterSide);
  const isOpen = !['CLOSED', 'CANCELLED'].includes(t.status);
  const stepFilesOf = (historyId: number) =>
    t.attachments.filter((a) => a.reference_type === 'STATUS' && a.reference_id === historyId);
  const ticketFiles = t.attachments.filter((a) => a.reference_type !== 'STATUS' && a.reference_type !== 'PART');

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
              onClick={() => openAction({ code: a.code, label: label(a.code, a.label) })}
            >
              {label(a.code, a.label)}
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
                        แจ้งเตือนงานค้างเกินเวลา
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
                    {stepFilesOf(h.history_id).length > 0 && (
                      <div className="mt-2 max-w-md">
                        <AttachmentGallery ticketId={t.ticket_id} items={stepFilesOf(h.history_id)} compact />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {t.parts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">รายการอะไหล่ที่ขอซื้อ</CardTitle></CardHeader>
              <CardContent>
                <PartsTable
                  ticketId={t.ticket_id}
                  parts={t.parts}
                  attachments={t.attachments}
                  canEditPrice={hasPermission('repair.supply') && ['WAIT_PART', 'PART_APPROVAL', 'PART_PURCHASING', 'PART_ARRIVED'].includes(t.status)}
                  onSaved={load}
                />
              </CardContent>
            </Card>
          )}

          {t.externals.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">ส่งซ่อมภายนอก</CardTitle></CardHeader>
              <CardContent><ExternalSummary items={t.externals} /></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">ไฟล์แนบ ({ticketFiles.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <AttachmentGallery ticketId={t.ticket_id} items={ticketFiles} currentPersonId={myId} canDelete={isOpen} onDeleted={load} />
              {isOpen && (
                <>
                  <AttachmentPicker files={extraFiles} onChange={setExtraFiles} />
                  {extraFiles.length > 0 && (
                    <Button onClick={uploadExtra} disabled={uploading} className="w-full bg-teal-700 hover:bg-teal-800">
                      {uploading ? 'กำลังอัปโหลด...' : `แนบ ${extraFiles.length} ไฟล์`}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

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
        <DialogContent className={kind === 'parts' ? 'sm:max-w-3xl' : 'sm:max-w-lg'}>
          <DialogHeader><DialogTitle>{kind === 'confirm' ? 'ยืนยันเปลี่ยนสถานะ' : action?.label}</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto py-2 pr-1">
            {kind === 'confirm' && action && (
              <p className="text-sm text-slate-700">
                เปลี่ยนสถานะ <span className="font-mono">{t.ticket_no}</span> จาก "{STATUS_LABEL[t.status]}" เป็น{' '}
                <span className="font-semibold">"{STATUS_LABEL[action.code]}"</span>
              </p>
            )}
            {kind === 'close' && (
              <>
                <div className="space-y-1">
                  <Label>ความพึงพอใจ</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setScore(n)} className={cn('text-2xl', n <= score ? 'text-amber-500' : 'text-slate-300')} aria-label={`${n} ดาว`}>★</button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {kind === 'done' && (
              <div className="space-y-1">
                <Label htmlFor="closeResult">ผลการซ่อม</Label>
                <select id="closeResult" className="h-10 w-full rounded-md border px-2 text-sm" value={closeResult} onChange={(e) => setCloseResult(e.target.value)}>
                  {Object.entries(CLOSE_RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            {kind === 'parts' && <PartsForm rows={partRows} onChange={setPartRows} />}
            {kind === 'extRequest' && <ExternalFields step="request" form={extForm} onChange={setExtForm} />}
            {kind === 'extSend' && <ExternalFields step="send" form={extForm} onChange={setExtForm} />}
            {kind === 'extReceive' && <ExternalFields step="receive" form={extForm} onChange={setExtForm} />}
            {kind !== 'confirm' && (
              <div className="space-y-1">
                <Label htmlFor="remark">
                  {kind === 'cancel' ? 'เหตุผลที่ยกเลิก (บังคับ)'
                    : kind === 'done' ? 'สิ่งที่ซ่อม / ผลการซ่อม (บังคับ)'
                    : kind === 'sendBack' ? 'เหตุผลที่ส่งกลับซ่อม (บังคับ)'
                    : kind === 'extRequest' ? 'อาการ / เหตุผลที่ต้องส่งซ่อมภายนอก (บังคับ)'
                    : kind === 'close' ? 'ความเห็นเพิ่มเติม'
                    : 'หมายเหตุ'}
                </Label>
                <Textarea id="remark" rows={kind === 'parts' ? 2 : 3} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            )}
            {showFiles && (
              <div className="space-y-1">
                <Label>{kind === 'done' ? 'รูปผลการซ่อม (ไม่บังคับ)' : 'รูปประกอบ (ไม่บังคับ)'}</Label>
                <AttachmentPicker files={stepFiles} onChange={setStepFiles} imagesOnly />
              </div>
            )}
            {action?.code === 'ACCEPTED' && t.asset_id && (
              <p className="text-xs text-slate-500">ทะเบียนครุภัณฑ์จะเปลี่ยนเป็น "อยู่ระหว่างซ่อม" จนกว่าจะปิดงาน</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={submitAction} disabled={!canSubmit}
              className={kind === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800'}>
              {saving ? 'กำลังบันทึก...' : 'ยืนยัน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RepairDetail;
