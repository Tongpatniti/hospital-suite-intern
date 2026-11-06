import { cn } from '@repo/ui/utils';
import { STATUS_CLASS, STATUS_LABEL, fmtHours, slaLevel } from '../lib/repair';

export function StatusPill({ status, warranty }: { status: string; warranty?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
          STATUS_CLASS[status] || 'bg-amber-100 text-amber-800'
        )}
      >
        {STATUS_LABEL[status] || status}
      </span>
      {warranty && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">ประกัน</span>}
    </span>
  );
}

export function SlaBadge({ hours, warn }: { hours: number; warn: number | null }) {
  const level = slaLevel(hours, warn);
  if (level === 'none') return <span className="text-xs text-slate-400">–</span>;
  const map = {
    ok: { dot: 'bg-emerald-500', text: 'text-slate-600', label: `ปกติ · ${fmtHours(hours)}/${fmtHours(warn!)}` },
    near: { dot: 'bg-amber-500', text: 'text-amber-700', label: `ใกล้ครบ · ${fmtHours(hours)}/${fmtHours(warn!)}` },
    over: { dot: 'bg-red-500', text: 'text-red-600', label: `เกินเวลา · ค้าง ${fmtHours(hours)}` },  }[level];
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs whitespace-nowrap', map.text)}>
      <span className={cn('h-2 w-2 rounded-full', map.dot)} />
      {map.label}
    </span>
  );
}
