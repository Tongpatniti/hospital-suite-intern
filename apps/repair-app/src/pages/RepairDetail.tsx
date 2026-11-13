import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
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
  TECH_HELD_STATUSES,
  URGENCY_LABEL,
  fmtHours,
  isAdmin,
  type AssetType,
} from '../lib/repair';
import { fmtDateTimeTH } from '../lib/format';
import { StatusPill } from '../components/RepairBadges';
import { AttachmentGallery, AttachmentPicker, type Attachment } from '../components/Attachments';
import { uploadPrepared, type PreparedFile } from '../lib/upload';
import { useAuth } from '../contexts/AuthContext';
import { ExternalFields, ExternalSummary, PartsForm, PartsTable, type External, type Part } from '../components/StepForms';
import { emptyExternal, emptyPart, filledParts, partsReady, todayLocal, type ExternalForm, type PartRow } from '../lib/stepForms';

interface History {
  history_id: number;
  from_status: string | null;
  to_status: string;
  remark: string | null;
  metadata: { event?: string; score?: number; close_result?: string } | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface PurchaseOrder {
  po_id: number;
  po_no: string;
  po_date: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_remark: string | null;
}

interface Progress {
  log_id: number;
  note: string;
  created_at: string;
  person_id: number;
  person_name: string;
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
  assignee_id: number | null;
  assignee_name: string | null;
  done_by_name: string | null;
  closed_by_name: string | null;
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
  brand: string | null;
  expected_days: number | null;
  externals: External[];
  purchase_orders: PurchaseOrder[];
  co_technicians: { person_id: number; person_name: string; added_at: string }[];
  progress_logs: Progress[];
}

interface TechOption { person_id: number; name: string }

type ActionKind = 'confirm' | 'cancel' | 'done' | 'close' | 'sendBack' | 'parts' | 'po' | 'reject' | 'extRequest' | 'extPrice' | 'extSend' | 'extReceive' | 'start';

// ขั้นไหนต้องกรอกอะไรเพิ่ม — ที่เหลือมีแค่ปุ่มยืนยัน/ยกเลิก
function actionKind(from: string, to: string): ActionKind {
  if (to === 'CANCELLED') return 'cancel';
  if (to === 'DONE') return 'done';
  if (to === 'CLOSED') return 'close';
  if (to === 'IN_PROGRESS' && (from === 'DONE' || from === 'CLOSED')) return 'sendBack';
  if (to === 'WAIT_PART') return 'parts';
  if (to === 'PO_PENDING') return 'po';
  if (to === 'PART_APPROVAL' && from === 'PO_PENDING') return 'reject';
  if (to === 'WAIT_EXTERNAL') return 'extRequest';
  if (to === 'EXT_PRICE_PENDING') return 'extPrice';
  if (to === 'EXT_APPROVAL' && from === 'EXT_PRICE_PENDING') return 'reject';
  if (to === 'UNREPAIRABLE_CHECK') return 'extReceive';
  if (to === 'IN_PROGRESS' && from === 'ACCEPTED') return 'start';
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
  if (to === 'PART_APPROVAL' && from !== 'PO_PENDING') return 'พัสดุรับเรื่องอะไหล่';
  if (to === 'PO_PENDING') return 'ส่งขออนุมัติ PO';
  if (to === 'PO_APPROVED') return 'อนุมัติ PO';
  if (to === 'PART_APPROVAL' && from === 'PO_PENDING') return 'ไม่อนุมัติ PO';
  if (to === 'PART_PURCHASING') return 'เริ่มจัดซื้ออะไหล่';
  if (to === 'PART_ARRIVED') return 'อะไหล่ถึงคลังแล้ว';
  if (to === 'EXT_APPROVAL' && from === 'EXT_PRICE_PENDING') return 'ไม่อนุมัติราคา ส่งกลับให้พัสดุ';
  if (to === 'EXT_APPROVAL') return 'พัสดุรับเรื่องส่งซ่อม';
  if (to === 'EXT_PRICE_PENDING') return 'ส่งขออนุมัติราคาซ่อมภายนอก';
  if (to === 'EXT_PRICE_APPROVED') return 'อนุมัติราคาซ่อมภายนอก';
  if (to === 'UNREPAIRABLE_CHECK') return 'รับคืน: ซ่อมไม่ได้/ไม่คุ้ม ส่งช่างตรวจซ้ำ';
  if (to === 'DISPOSAL') return 'ช่างตรวจซ้ำแล้ว ส่งรอจำหน่าย';
  if (to === 'IN_PROGRESS' && from === 'UNREPAIRABLE_CHECK') return 'ช่างตรวจซ้ำแล้ว ซ่อมต่อได้';
  if (to === 'EXT_SENT') return 'ส่งร้านภายนอกแล้ว';
  if (to === 'EXT_RECEIVED') return 'รับอุปกรณ์คืนแล้ว';
  if (to === 'IN_PROGRESS' && from === 'PART_ARRIVED') return 'รับอะไหล่แล้ว ซ่อมต่อ';
  if (to === 'IN_PROGRESS' && from === 'EXT_RECEIVED') return 'ตรวจรับอุปกรณ์และซ่อมต่อ';
  if (to === 'IN_PROGRESS') return 'เริ่มดำเนินงาน';
  if (to === 'CLOSED') return 'ตรวจรับและปิดงาน';
  if (to === 'DONE') return 'ซ่อมเสร็จ';
  return fallback;
}

const PO_STATUS_LABEL: Record<string, string> = {
  PENDING: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
};

type TimelineItem =
  | { kind: 'history'; at: string; h: History }
  | { kind: 'alert'; at: string; a: Ticket['sla_alerts'][number] };

const RepairDetail: React.FC = () => {
  const { id } = useParams();
  const [t, setT] = useState<Ticket | null>(null);
  const [action, setAction] = useState<{ code: string; label: string } | null>(null);
  const [remark, setRemark] = useState('');
  const [expectedDays, setExpectedDays] = useState('');
  const [score, setScore] = useState(5);
  const [closeResult, setCloseResult] = useState('REPAIRED');
  const [poNo, setPoNo] = useState('');
  const [poDate, setPoDate] = useState(todayLocal());
  const [saving, setSaving] = useState(false);
  const [stepFiles, setStepFiles] = useState<PreparedFile[]>([]);
  const [extraFiles, setExtraFiles] = useState<PreparedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [partRows, setPartRows] = useState<PartRow[]>([emptyPart()]);
  const [extForm, setExtForm] = useState<ExternalForm>(emptyExternal());
  const [techs, setTechs] = useState<TechOption[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [assetChangeOpen, setAssetChangeOpen] = useState(false);
  const [assetChangeTo, setAssetChangeTo] = useState('');
  const [assetChangeReason, setAssetChangeReason] = useState('');
  const [assetOptions, setAssetOptions] = useState<{ asset_id: number; asset_code: string; name: string; asset_type: AssetType }[]>([]);
  const [coTechPick, setCoTechPick] = useState('');
  const [progressNote, setProgressNote] = useState('');
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

  const isAdminUser = isAdmin(hasPermission);
  const isAssignee = !!t && t.assignee_id === myId;
  const isCoTech = !!t && t.co_technicians.some((c) => c.person_id === myId);
  const isTeam = isAssignee || isCoTech || isAdminUser;
  const techHeld = !!t && TECH_HELD_STATUSES.includes(t.status);
  const canManageTeam = techHeld && (isAssignee || isAdminUser);
  const canRecordProgress = !!t && t.status === 'IN_PROGRESS' && isTeam;

  useEffect(() => {
    if (!t || !canManageTeam) { setTechs([]); return; }
    api.get('/api/repair-technicians', { params: { asset_type: t.asset_type } })
      .then((res) => setTechs(res.data.data))
      .catch(() => setTechs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.ticket_id, t?.asset_type, canManageTeam]);

  const openAction = (a: { code: string; label: string }) => {
    setAction(a);
    setRemark('');
    setScore(5);
    setCloseResult('REPAIRED');
    setPoNo('');
    setPoDate(todayLocal());
    setStepFiles([]);
    setPartRows([emptyPart()]);
    setExtForm(emptyExternal());
    setExpectedDays('');
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
        expected_days: action.code === 'IN_PROGRESS' ? Number(expectedDays) : undefined,
        attachment_ids: uploadedIds,
        parts,
        po: action.code === 'PO_PENDING' ? { po_no: poNo.trim(), po_date: poDate || null } : undefined,
        external: ['WAIT_EXTERNAL', 'EXT_PRICE_PENDING', 'EXT_SENT', 'EXT_RECEIVED', 'UNREPAIRABLE_CHECK'].includes(action.code)
          ? {
              ...extForm,
              sent_date: extForm.sent_date || null,
              return_date: extForm.return_date || null,
              actual_cost: extForm.actual_cost === '' ? null : Number(extForm.actual_cost),
              quoted_price: extForm.quoted_price === '' ? null : Number(extForm.quoted_price),
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

  const runTeamAction = async (fn: () => Promise<unknown>, okMessage: string) => {
    try {
      await fn();
      toast({ title: okMessage });
      load();
    } catch (err) {
      toast({ title: errorMessage(err, 'ทำรายการไม่สำเร็จ'), variant: 'destructive' });
    }
  };

  const openAssetChange = () => {
    setAssetChangeTo('');
    setAssetChangeReason('');
    setAssetChangeOpen(true);
    api.get('/api/repair-assets', { params: { q: '' } })
      .then((res) => setAssetOptions(res.data.data))
      .catch(() => setAssetOptions([]));
  };

  const submitAssetChange = async () => {
    if (!t) return;
    await runTeamAction(async () => {
      await api.patch(`/api/repairs/${t.ticket_id}/asset`, {
        asset_id: assetChangeTo === '' ? null : Number(assetChangeTo),
        reason: assetChangeReason.trim(),
      });
      setAssetChangeOpen(false);
    }, 'เปลี่ยนประเภทครุภัณฑ์แล้ว');
  };

  const submitTransfer = async () => {
    if (!t) return;
    await runTeamAction(async () => {
      await api.post(`/api/repairs/${t.ticket_id}/transfer`, { to_person_id: Number(transferTo), reason: transferReason.trim() });
      setTransferOpen(false);
    }, 'โอนงานแล้ว');
  };

  const addCoTech = async () => {
    if (!t || !coTechPick) return;
    await runTeamAction(async () => {
      await api.post(`/api/repairs/${t.ticket_id}/co-technicians`, { person_id: Number(coTechPick) });
      setCoTechPick('');
    }, 'เพิ่มผู้ร่วมซ่อมแล้ว');
  };

  const submitProgress = async () => {
    if (!t || !progressNote.trim()) return;
    await runTeamAction(async () => {
      await api.post(`/api/repairs/${t.ticket_id}/progress`, { note: progressNote.trim() });
      setProgressNote('');
    }, 'บันทึกความคืบหน้าแล้ว');
  };

  if (!t) return <p className="text-slate-400">กำลังโหลด...</p>;

  const timeline: TimelineItem[] = [
    ...t.history.map((h) => ({ kind: 'history' as const, at: h.changed_at, h })),
    ...t.sla_alerts.map((a) => ({ kind: 'alert' as const, at: a.sent_at, a })),
  ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

  const kind: ActionKind = action ? actionKind(t.status, action.code) : 'confirm';
  const needRemark = kind === 'cancel' || kind === 'done' || kind === 'sendBack' || kind === 'extRequest' || kind === 'reject'
    || action?.code === 'UNREPAIRABLE_CHECK' || action?.code === 'DISPOSAL';
  const canSubmit = !saving
    && (!needRemark || remark.trim() !== '')
    && (kind !== 'parts' || partsReady(partRows))
    && (kind !== 'po' || poNo.trim() !== '')
    && (kind !== 'extSend' || extForm.sent_date !== '')
    && (kind !== 'extPrice' || (extForm.vendor_name.trim() !== '' && extForm.quoted_price.trim() !== ''))
    && (kind !== 'start' || Number(expectedDays) >= 1)
    && (kind !== 'extReceive' || (extForm.return_date !== '' && (action?.code === 'UNREPAIRABLE_CHECK' || extForm.actual_cost.trim() !== '')));
  const showFiles = kind === 'done' || kind === 'extRequest' || kind === 'po';
  const isTechSide = hasPermission(`repair.${t.asset_type.toLowerCase()}.tech`) || isAdminUser;
  const isRequesterSide = t.requester_id === myId && !isTechSide;
  const label = (code: string, fallback: string) => actionLabel(t.status, code, fallback, isRequesterSide);
  const isOpen = !['CLOSED', 'CANCELLED', 'DISPOSAL'].includes(t.status);
  const stepFilesOf = (historyId: number) =>
    t.attachments.filter((a) => a.reference_type === 'STATUS' && a.reference_id === historyId);
  const ticketFiles = t.attachments.filter((a) => a.reference_type !== 'STATUS' && a.reference_type !== 'PART');
  const coTechIds = new Set(t.co_technicians.map((c) => c.person_id));
  const transferCandidates = techs.filter((p) => p.person_id !== t.assignee_id);
  const coTechCandidates = techs.filter((p) => p.person_id !== t.assignee_id && !coTechIds.has(p.person_id));

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
          {isAssignee && ['ACCEPTED', 'IN_PROGRESS'].includes(t.status) && (
            <Button variant="outline" onClick={openAssetChange}>เปลี่ยนประเภทครุภัณฑ์</Button>
          )}
          {canManageTeam && (
            <Button variant="outline" onClick={() => { setTransferTo(''); setTransferReason(''); setTransferOpen(true); }}>
              โอนงานให้ช่างคนอื่น
            </Button>
          )}
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
          {(canRecordProgress || t.progress_logs.length > 0) && (
            <Card>
              <CardHeader><CardTitle className="text-base">ความคืบหน้าการซ่อม ({t.progress_logs.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {canRecordProgress && (
                  <div className="space-y-2">
                    <Textarea rows={2} placeholder="บันทึกสิ่งที่ดำเนินการ / ความคืบหน้า" value={progressNote} onChange={(e) => setProgressNote(e.target.value)} />
                    <Button onClick={submitProgress} disabled={!progressNote.trim()} className="w-full bg-teal-700 hover:bg-teal-800">บันทึกความคืบหน้า</Button>
                  </div>
                )}
                {t.progress_logs.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีการบันทึกความคืบหน้า</p>}
                <ol className="space-y-3">
                  {[...t.progress_logs].reverse().map((p) => (
                    <li key={p.log_id} className="relative border-l-2 border-teal-200 pl-4">
                      <span className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-teal-600" />
                      <p className="text-xs text-slate-500">{fmtDateTimeTH(p.created_at)} · {p.person_name}</p>
                      <p className="whitespace-pre-line text-sm text-slate-700">{p.note}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {(t.co_technicians.length > 0 || canManageTeam) && (
            <Card>
              <CardHeader><CardTitle className="text-base">ผู้ร่วมซ่อม ({t.co_technicians.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {t.co_technicians.length === 0 && <p className="text-slate-400">ยังไม่มีผู้ร่วมซ่อม</p>}
                {t.co_technicians.map((c) => (
                  <div key={c.person_id} className="flex items-center justify-between gap-2">
                    <span>{c.person_name}</span>
                    {canManageTeam && (
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => runTeamAction(() => api.delete(`/api/repairs/${t.ticket_id}/co-technicians/${c.person_id}`), 'นำผู้ร่วมซ่อมออกแล้ว')}
                      >
                        นำออก
                      </button>
                    )}
                  </div>
                ))}
                {canManageTeam && (
                  <div className="flex gap-2 pt-2">
                    <select className="h-9 flex-1 rounded-md border px-2 text-sm" value={coTechPick} onChange={(e) => setCoTechPick(e.target.value)} aria-label="เลือกผู้ร่วมซ่อม">
                      <option value="">— เลือกช่างเพิ่มเป็นผู้ร่วมซ่อม —</option>
                      {coTechCandidates.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}</option>)}
                    </select>
                    <Button variant="outline" onClick={addCoTech} disabled={!coTechPick}>เพิ่ม</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {t.parts.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">รายการอะไหล่ที่ขอซื้อ</CardTitle></CardHeader>
              <CardContent>
                <PartsTable
                  ticketId={t.ticket_id}
                  parts={t.parts}
                  attachments={t.attachments}
                  canEditPrice={hasPermission('repair.supply') && ['WAIT_PART', 'PART_APPROVAL', 'PO_PENDING', 'PO_APPROVED', 'PART_PURCHASING', 'PART_ARRIVED'].includes(t.status)}
                  onSaved={load}
                />
              </CardContent>
            </Card>
          )}

          {t.purchase_orders.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">ใบสั่งซื้อ (PO)</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {t.purchase_orders.map((po) => (
                  <div key={po.po_id} className="rounded-md border p-3">
                    <p className="font-mono">{po.po_no}
                      <span className={cn('ml-2 rounded-full px-2 py-0.5 text-xs',
                        po.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800'
                          : po.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800')}>
                        {PO_STATUS_LABEL[po.status]}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {po.po_date ? `วันที่ PO ${po.po_date.slice(0, 10)} · ` : ''}
                      ขอโดย {po.requested_by_name || '-'} เมื่อ {fmtDateTimeTH(po.requested_at)}
                    </p>
                    {po.decided_at && (
                      <p className="text-xs text-slate-500">
                        ผลการพิจารณาโดย {po.decided_by_name || '-'} เมื่อ {fmtDateTimeTH(po.decided_at)}
                        {po.decision_remark && ` · ${po.decision_remark}`}
                      </p>
                    )}
                  </div>
                ))}
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
                <dt className="text-slate-500">ยี่ห้อ</dt><dd>{t.brand || '-'}</dd>
                <dt className="text-slate-500">ระยะเวลาที่คาดไว้</dt><dd>{t.expected_days ? `${t.expected_days} วัน` : '-'}</dd>
                <dt className="text-slate-500">ผู้แจ้ง</dt><dd>{t.requester_name}</dd>
                <dt className="text-slate-500">ช่างผู้รับผิดชอบ</dt><dd>{t.assignee_name || '-'}</dd>
                <dt className="text-slate-500">ผู้ซ่อมเสร็จ</dt><dd>{t.done_by_name || '-'}</dd>
                <dt className="text-slate-500">ผู้ปิดงาน</dt><dd>{t.closed_by_name || '-'}</dd>
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

      <Dialog open={transferOpen} onOpenChange={(o) => !o && setTransferOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>โอนงานให้ช่างคนอื่น</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              เลือกช่างที่มีสิทธิ์รับงาน{ASSET_TYPE_LABEL[t.asset_type]} ระบบจะเปลี่ยนชื่อผู้รับผิดชอบเป็นช่างที่รับโอน
            </p>
            <div className="space-y-1">
              <Label htmlFor="transferTo">ช่างที่รับโอน *</Label>
              <select id="transferTo" className="h-10 w-full rounded-md border px-2 text-sm" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">— เลือกช่าง —</option>
                {transferCandidates.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="transferReason">เหตุผลการโอน</Label>
              <Textarea id="transferReason" rows={3} value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitTransfer} disabled={!transferTo} className="bg-teal-700 hover:bg-teal-800">ยืนยันการโอนงาน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assetChangeOpen} onOpenChange={(o) => !o && setAssetChangeOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>เปลี่ยนประเภทครุภัณฑ์</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              เลือกครุภัณฑ์ที่มีรหัสประเภท{ASSET_TYPE_LABEL[t.asset_type]} หรือเลือก "ไม่มีรหัสครุภัณฑ์" ระบบจะคืนสถานะทะเบียนของเครื่องเดิมให้
            </p>
            <div className="space-y-1">
              <Label htmlFor="assetChangeTo">ครุภัณฑ์</Label>
              <select id="assetChangeTo" className="h-10 w-full rounded-md border px-2 text-sm" value={assetChangeTo} onChange={(e) => setAssetChangeTo(e.target.value)}>
                <option value="">ไม่มีรหัสครุภัณฑ์</option>
                {assetOptions.filter((a) => a.asset_type === t.asset_type).map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>{a.asset_code} · {a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="assetChangeReason">เหตุผลที่เปลี่ยน *</Label>
              <Textarea id="assetChangeReason" rows={3} value={assetChangeReason} onChange={(e) => setAssetChangeReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetChangeOpen(false)}>ยกเลิก</Button>
            <Button onClick={submitAssetChange} disabled={!assetChangeReason.trim()} className="bg-teal-700 hover:bg-teal-800">ยืนยัน</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {kind === 'po' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="poNo">เลขที่ใบสั่งซื้อ PO *</Label>
                  <Input id="poNo" value={poNo} onChange={(e) => setPoNo(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="poDate">วันที่ PO</Label>
                  <Input id="poDate" type="date" value={poDate} max={todayLocal()} onChange={(e) => setPoDate(e.target.value)} />
                </div>
              </div>
            )}
            {kind === 'extRequest' && <ExternalFields step="request" form={extForm} onChange={setExtForm} />}
            {kind === 'extPrice' && <ExternalFields step="price" form={extForm} onChange={setExtForm} />}
            {kind === 'start' && (
              <div className="space-y-1">
                <Label htmlFor="expectedDays">ระยะเวลาที่คาดไว้ในการซ่อม (จำนวนวัน) *</Label>
                <Input id="expectedDays" type="number" min="1" step="1" value={expectedDays} onChange={(e) => setExpectedDays(e.target.value)} />
              </div>
            )}
            {kind === 'extSend' && <ExternalFields step="send" form={extForm} onChange={setExtForm} />}
            {kind === 'extReceive' && <ExternalFields step="receive" form={extForm} onChange={setExtForm} />}
            {(kind !== 'confirm' || action?.code === 'DISPOSAL') && (
              <div className="space-y-1">
                <Label htmlFor="remark">
                  {kind === 'cancel' ? 'เหตุผลที่ยกเลิก (บังคับ)'
                    : kind === 'done' ? 'สิ่งที่ซ่อม / ผลการซ่อม (บังคับ)'
                    : kind === 'sendBack' ? 'เหตุผลที่ส่งกลับซ่อม (บังคับ)'
                    : kind === 'extRequest' ? 'อาการ / เหตุผลที่ต้องส่งซ่อมภายนอก (บังคับ)'
                    : action?.code === 'UNREPAIRABLE_CHECK' ? 'เหตุผลที่ซ่อมไม่ได้หรือไม่คุ้ม (บังคับ)'
                    : action?.code === 'DISPOSAL' ? 'เหตุผลที่ส่งรอจำหน่าย (บังคับ)'
                    : kind === 'reject' && t.status === 'EXT_PRICE_PENDING' ? 'เหตุผลที่ไม่อนุมัติราคา (บังคับ)'
                    : kind === 'reject' ? 'เหตุผลที่ไม่อนุมัติ PO (บังคับ)'
                    : kind === 'close' ? 'ข้อเสนอแนะ'
                    : 'หมายเหตุ'}
                </Label>
                <Textarea id="remark" rows={kind === 'parts' ? 2 : 3} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            )}
            {showFiles && (
              <div className="space-y-1">
                <Label>
                  {kind === 'done' ? 'รูปผลการซ่อม (ไม่บังคับ)'
                    : kind === 'po' ? 'เอกสารใบสั่งซื้อ PO (ไม่บังคับ)'
                    : 'รูปประกอบ (ไม่บังคับ)'}
                </Label>
                <AttachmentPicker files={stepFiles} onChange={setStepFiles} imagesOnly={kind !== 'po'} />
              </div>
            )}
            {action?.code === 'ACCEPTED' && t.asset_id && (
              <p className="text-xs text-slate-500">ทะเบียนครุภัณฑ์จะเปลี่ยนเป็น "อยู่ระหว่างซ่อม" จนกว่าจะปิดงาน</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={saving}>ยกเลิก</Button>
            <Button onClick={submitAction} disabled={!canSubmit}
              className={kind === 'cancel' || kind === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800'}>
              {saving ? 'กำลังบันทึก...' : 'ยืนยัน'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RepairDetail;
