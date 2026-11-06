import type { PreparedFile } from './upload';

export interface PartRow {
  part_name: string;
  part_no: string;
  qty: string;
  unit: string;
  estimated_unit_price: string;
  note: string;
  files: PreparedFile[]; // รูปของรายการนี้ (บังคับอย่างน้อย 1 รูป)
}

export const emptyPart = (): PartRow => ({ part_name: '', part_no: '', qty: '1', unit: 'ชิ้น', estimated_unit_price: '', note: '', files: [] });

export function partsTotal(rows: PartRow[]) {
  return rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.estimated_unit_price) || 0), 0);
}

/** แถวที่กรอกชื่อแล้ว */
export function filledParts(rows: PartRow[]) {
  return rows.filter((r) => r.part_name.trim());
}

/** ทุกแถวที่กรอกชื่อมีจำนวนถูกต้องและมีรูปอย่างน้อย 1 รูป และมีอย่างน้อย 1 แถว */
export function partsReady(rows: PartRow[]) {
  const filled = filledParts(rows);
  return filled.length > 0 && filled.every((r) => Number(r.qty) > 0 && r.files.length > 0);
}

export interface ExternalForm {
  suggested_vendor: string;
  is_warranty: boolean;
  vendor_name: string;
  sent_date: string;
  return_date: string;
  actual_cost: string;
  invoice_no: string;
}

/** วันที่วันนี้ตามเวลาเครื่อง (YYYY-MM-DD) สำหรับค่าเริ่มต้นของช่องวันที่ */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const emptyExternal = (): ExternalForm => ({
  suggested_vendor: '', is_warranty: false, vendor_name: '',
  sent_date: todayLocal(), return_date: todayLocal(), actual_cost: '', invoice_no: '',
});
