// แสดงวันเวลาเป็นโซนไทย (พ.ศ.)
export function fmtDateTimeTH(v: string | null | undefined): string {
  if (!v) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (m && !v.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(v)) {
    return `${m[3]}/${m[2]}/${Number(m[1]) + 543} ${m[4]}:${m[5]}`;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

export function fmtMoney(v: number | string | null | undefined): string {
  if (v == null) return '-';
  return Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
