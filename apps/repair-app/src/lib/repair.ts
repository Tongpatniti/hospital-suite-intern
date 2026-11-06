export type AssetType = 'COMPUTER' | 'MEDICAL' | 'GENERAL';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  COMPUTER: 'คอมพิวเตอร์',
  MEDICAL: 'เครื่องมือแพทย์',
  GENERAL: 'ทั่วไป',
};

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'แจ้งซ่อม',
  ACCEPTED: 'รับงานซ่อม',
  IN_PROGRESS: 'กำลังดำเนินงาน',
  WAIT_PART: 'สั่งซื้ออะไหล่',
  PART_APPROVAL: 'รออนุมัติอะไหล่',
  PART_PURCHASING: 'กำลังจัดซื้ออะไหล่',
  PART_ARRIVED: 'อะไหล่ถึงคลัง',
  WAIT_EXTERNAL: 'แจ้งส่งซ่อมภายนอก',
  EXT_APPROVAL: 'รออนุมัติส่งซ่อม',
  EXT_SENT: 'ส่งร้านภายนอกแล้ว',
  EXT_RECEIVED: 'รับเครื่องคืนแล้ว',
  DONE: 'รอตรวจรับ',
  CLOSED: 'ปิดงาน',
  CANCELLED: 'ยกเลิก',
};

export const STATUS_CLASS: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-800',
  ACCEPTED: 'bg-teal-100 text-teal-800',
  IN_PROGRESS: 'bg-teal-100 text-teal-800',
  DONE: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-slate-100 text-slate-500 line-through',
};

export const URGENCY_LABEL: Record<string, string> = {
  LOW: 'ต่ำ',
  NORMAL: 'ปกติ',
  HIGH: 'สูง',
  CRITICAL: 'วิกฤต',
};

export const ASSET_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'ใช้งานได้',
  REPAIRING: 'อยู่ระหว่างซ่อม',
  DISPOSAL: 'รอจำหน่าย',
};

export const CLOSE_RESULT_LABEL: Record<string, string> = {
  REPAIRED: 'ซ่อมได้',
  UNREPAIRABLE: 'ซ่อมไม่ได้ (รอจำหน่าย)',
  NOT_FOUND: 'ตรวจแล้วไม่พบอาการเสีย',
};

export const EVENT_LABEL: Record<string, string> = {
  PART_ISSUED: 'ช่างรับอะไหล่แล้ว อยู่ระหว่างการซ่อม',
  EXT_INSPECTED: 'ช่างตรวจรับเครื่องจากร้านภายนอกแล้ว',
  DUPLICATE_WATCH: 'มีผู้แจ้งปัญหาเดียวกันเพิ่ม',
  REOPEN: 'เปิดงานซ่อมอีกครั้ง',
};

export function fmtHours(h: number) {
  return h >= 48 ? `${(h / 24).toFixed(1)} วัน` : `${Math.floor(h)} ชม.`;
}

export type SlaLevel = 'ok' | 'near' | 'over' | 'none';

export function slaLevel(hours: number, warn: number | null): SlaLevel {
  if (!warn) return 'none';
  if (hours >= warn) return 'over';
  if (hours >= warn * 0.8) return 'near';
  return 'ok';
}
