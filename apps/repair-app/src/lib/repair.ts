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
  PART_APPROVAL: 'พัสดุรับเรื่องอะไหล่',
  PO_PENDING: 'รออนุมัติ PO',
  PO_APPROVED: 'ได้รับการอนุมัติ PO แล้ว',
  PART_PURCHASING: 'กำลังจัดซื้ออะไหล่',
  PART_ARRIVED: 'อะไหล่ถึงคลัง',
  WAIT_EXTERNAL: 'แจ้งส่งซ่อมภายนอก',
  EXT_APPROVAL: 'รออนุมัติส่งซ่อม',
  EXT_SENT: 'ส่งร้านภายนอกแล้ว',
  EXT_RECEIVED: 'รับอุปกรณ์คืนแล้ว',
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
  TRANSFER: 'โอนงานให้ช่างคนใหม่',
  CO_TECH_ADDED: 'เพิ่มผู้ร่วมซ่อม',
  CO_TECH_REMOVED: 'นำผู้ร่วมซ่อมออก',
  PO_REJECTED: 'ไม่อนุมัติ PO ส่งกลับให้พัสดุตรวจสอบอีกครั้ง',
};

// สถานะที่พัสดุดำเนินการ (ตรงกับ SUPPLY_STATUSES ฝั่ง backend)
export const SUPPLY_STATUSES = [
  'WAIT_PART', 'PART_APPROVAL', 'PO_PENDING', 'PO_APPROVED', 'PART_PURCHASING', 'PART_ARRIVED',
  'WAIT_EXTERNAL', 'EXT_APPROVAL', 'EXT_SENT',
];

// สถานะที่ช่างผู้รับผิดชอบยังถือใบงานอยู่ (ตรงกับ TECH_HELD_STATUSES ฝั่ง backend)
export const TECH_HELD_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'WAIT_PART', 'WAIT_EXTERNAL', 'PART_ARRIVED', 'EXT_RECEIVED'];

type HasPermission = (permission: string) => boolean;

export const isAdmin = (has: HasPermission) => has('repair.all');
export const canRequestType = (has: HasPermission, t: AssetType) =>
  isAdmin(has) || has(`repair.${t.toLowerCase()}.request`);
export const isTechOf = (has: HasPermission, t: AssetType) =>
  isAdmin(has) || has(`repair.${t.toLowerCase()}.tech`);
export const canViewType = (has: HasPermission, t: AssetType) =>
  isTechOf(has, t) || canRequestType(has, t) || has('repair.supply') || has('repair.po.approve');
export const hasAnyTech = (has: HasPermission) => (Object.keys(ASSET_TYPE_LABEL) as AssetType[]).some((t) => isTechOf(has, t));

export const TYPE_LIST_LABEL: Record<AssetType, string> = {
  COMPUTER: 'คอมพิวเตอร์',
  MEDICAL: 'เครื่องมือแพทย์',
  GENERAL: 'ทั่วไป',
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
