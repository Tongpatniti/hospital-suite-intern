import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Trash2, X } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import api from '../lib/api';
import { fmtSize, loadLimits, prepareFile, type PreparedFile, type UploadLimits, DEFAULT_LIMITS } from '../lib/upload';
import { fmtDateTimeTH } from '../lib/format';

// ---------------------------------------------------------------------------
// เลือกไฟล์ + ย่อรูปในเครื่องก่อนส่ง (ยังไม่อัปโหลด — หน้าที่ใช้เป็นคนเรียก uploadPrepared)
// ---------------------------------------------------------------------------
export function AttachmentPicker({
  files,
  onChange,
  imagesOnly,
  hint,
}: {
  files: PreparedFile[];
  onChange: (files: PreparedFile[]) => void;
  imagesOnly?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [limits, setLimits] = useState<UploadLimits>(DEFAULT_LIMITS);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadLimits().then(setLimits); }, []);

  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    const next = [...files];
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      if (next.length >= 10) { errs.push('แนบได้สูงสุด 10 ไฟล์ต่อครั้ง'); break; }
      if (imagesOnly && /\.pdf$/i.test(f.name)) { errs.push(`${f.name}: ขั้นนี้ต้องแนบเป็นรูป`); continue; }
      try {
        const p = await prepareFile(f, limits);
        if (next.some((x) => x.key === p.key)) continue;
        next.push(p);
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    onChange(next);
    setErrors(errs);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (key: string) => {
    const f = files.find((x) => x.key === key);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    onChange(files.filter((x) => x.key !== key));
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
        className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm text-slate-500 hover:border-teal-600 hover:text-teal-700"
      >
        <Paperclip className="h-5 w-5" />
        {busy ? 'กำลังย่อรูป...' : 'คลิกหรือลากไฟล์มาวาง'}
        <span className="text-xs text-slate-400">
          {hint || (imagesOnly
            ? `รูป JPG, PNG, WEBP, HEIC ไม่เกิน ${limits.imageMaxMb} MB`
            : `รูป JPG, PNG, WEBP, HEIC ไม่เกิน ${limits.imageMaxMb} MB · PDF ไม่เกิน ${limits.pdfMaxMb} MB`)}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={imagesOnly ? 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif' : 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf'}
        onChange={(e) => add(e.target.files)}
      />
      {errors.map((e) => <p key={e} className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{e}</p>)}
      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((f) => (
            <li key={f.key} className="relative overflow-hidden rounded-md border bg-slate-50">
              {f.preview
                ? <img src={f.preview} alt={f.file_name} className="h-24 w-full object-cover" />
                : <div className="flex h-24 items-center justify-center text-slate-400"><FileText className="h-8 w-8" /></div>}
              <div className="px-2 py-1 text-[11px]">
                <p className="truncate">{f.file_name}</p>
                <p className="text-slate-500">
                  {f.kind === 'IMAGE' ? `${fmtSize(f.original_size)} → ${fmtSize(f.size)}` : fmtSize(f.size)}
                </p>
              </div>
              <button type="button" onClick={() => remove(f.key)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-600 hover:text-red-600" aria-label={`ลบ ${f.file_name}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// แสดงไฟล์ที่แนบแล้ว (โหลดผ่าน API เพราะต้องส่ง header x-person-id)
// ---------------------------------------------------------------------------
export interface Attachment {
  attachment_id: number;
  reference_type: string;
  reference_id: number | null;
  file_kind: 'IMAGE' | 'PDF';
  file_name: string;
  file_size: number;
  original_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  has_thumb: boolean;
}

function Thumb({ ticketId, a }: { ticketId: number; a: Attachment }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (a.file_kind !== 'IMAGE') return;
    let url: string | null = null;
    api.get(`/api/repairs/${ticketId}/attachments/${a.attachment_id}`, { params: { thumb: a.has_thumb ? 1 : undefined }, responseType: 'blob' })
      .then((r) => { url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [ticketId, a.attachment_id, a.file_kind, a.has_thumb]);

  if (a.file_kind === 'PDF') return <div className="flex h-24 items-center justify-center text-slate-400"><FileText className="h-8 w-8" /></div>;
  return src ? <img src={src} alt={a.file_name} className="h-24 w-full object-cover" /> : <div className="h-24 animate-pulse bg-slate-100" />;
}

export function AttachmentGallery({
  ticketId,
  items,
  currentPersonId,
  canDelete,
  onDeleted,
  compact,
}: {
  ticketId: number;
  items: Attachment[];
  currentPersonId?: number;
  canDelete?: boolean;
  onDeleted?: () => void;
  compact?: boolean;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const open = async (a: Attachment) => {
    // เปิดแท็บก่อน (กัน popup blocker) แล้วค่อยใส่ไฟล์
    const w = window.open('', '_blank');
    try {
      const r = await api.get(`/api/repairs/${ticketId}/attachments/${a.attachment_id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      if (w) {
        w.location.replace(url);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.click();
      }
    } catch {
      w?.close();
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/repairs/${ticketId}/attachments/${id}`);
      onDeleted?.();
    } finally {
      setConfirmId(null);
    }
  };

  if (items.length === 0) return compact ? null : <p className="text-sm text-slate-400">ยังไม่มีไฟล์แนบ</p>;

  return (
    <ul className={cn('grid gap-2', compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')}>
      {items.map((a) => {
        const deletable = canDelete && a.uploaded_by === currentPersonId && !(a.reference_type === 'STATUS');
        return (
          <li key={a.attachment_id} className="relative overflow-hidden rounded-md border bg-white">
            <button type="button" onClick={() => open(a)} className="block w-full text-left" title="เปิดไฟล์">
              <Thumb ticketId={ticketId} a={a} />
              {!compact && (
                <div className="px-2 py-1 text-[11px]">
                  <p className="truncate">{a.file_name}</p>
                  <p className="text-slate-500">{fmtSize(a.file_size)} · {a.uploaded_by_name} · {fmtDateTimeTH(a.uploaded_at)}</p>
                </div>
              )}
            </button>
            {deletable && (
              confirmId === a.attachment_id ? (
                <div className="absolute inset-x-1 top-1 flex gap-1 rounded bg-white/95 p-1 text-[11px] shadow">
                  <button type="button" onClick={() => remove(a.attachment_id)} className="flex-1 rounded bg-red-600 px-1 py-0.5 text-white">ยืนยันลบ</button>
                  <button type="button" onClick={() => setConfirmId(null)} className="flex-1 rounded border px-1 py-0.5">ไม่ลบ</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmId(a.attachment_id)} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-600 hover:text-red-600" aria-label={`ลบ ${a.file_name}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
