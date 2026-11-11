import api from './api';

// ===========================================================================
// เตรียมไฟล์แนบก่อนส่ง (spec 8.9)
// - รูป: หมุนตาม EXIF, ย่อด้านยาว <= maxPx, เข้ารหัสใหม่เป็น WebP (หรือ JPEG ถ้าเบราว์เซอร์ไม่รองรับ)
//        การวาดลง canvas แล้วเข้ารหัสใหม่ทำให้ข้อมูล EXIF/GPS หายไปเอง และไม่เก็บไฟล์ต้นฉบับ
// - PDF: ส่งตามเดิม
// ===========================================================================

export interface UploadLimits {
  imageMaxMb: number;
  pdfMaxMb: number;
  maxPx: number;
  maxFilesPerTicket: number;
}

export const DEFAULT_LIMITS: UploadLimits = { imageMaxMb: 15, pdfMaxMb: 10, maxPx: 1920, maxFilesPerTicket: 30 };

export interface PreparedFile {
  key: string;
  file_name: string;
  kind: 'IMAGE' | 'PDF';
  data: string; // data URL
  thumb?: string;
  preview?: string; // object URL สำหรับแสดงในหน้า
  original_size: number;
  size: number;
  width?: number;
  height?: number;
}

export async function loadLimits(): Promise<UploadLimits> {
  try {
    const res = await api.get('/api/repair-settings');
    const m = Object.fromEntries((res.data.data as { setting_key: string; setting_value: string }[]).map((s) => [s.setting_key, Number(s.setting_value)]));
    return {
      imageMaxMb: m.attach_image_max_mb || DEFAULT_LIMITS.imageMaxMb,
      pdfMaxMb: m.attach_pdf_max_mb || DEFAULT_LIMITS.pdfMaxMb,
      maxPx: m.attach_image_max_px || DEFAULT_LIMITS.maxPx,
      maxFilesPerTicket: m.attach_max_files_per_ticket || DEFAULT_LIMITS.maxFilesPerTicket,
    };
  } catch {
    return DEFAULT_LIMITS;
  }
}

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function encode(bitmap: ImageBitmap, maxPx: number, quality: number) {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new Error('encode');
  return { blob, w, h };
}

export async function prepareFile(file: File, limits: UploadLimits): Promise<PreparedFile> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || IMAGE_EXT.test(file.name);
  const key = `${file.name}-${file.size}-${file.lastModified}`;

  if (isPdf) {
    if (file.size > limits.pdfMaxMb * 1024 * 1024) throw new Error(`${file.name}: ไฟล์ใหญ่เกินกำหนด (PDF สูงสุด ${limits.pdfMaxMb} MB)`);
    return { key, file_name: file.name, kind: 'PDF', data: await blobToDataUrl(file), original_size: file.size, size: file.size };
  }
  if (!isImage) {
    throw new Error(`${file.name}: รองรับเฉพาะไฟล์รูป (JPG, PNG, WEBP, HEIC) และ PDF`);
  }
  if (file.size > limits.imageMaxMb * 1024 * 1024) throw new Error(`${file.name}: ไฟล์ใหญ่เกินกำหนด (รูปสูงสุด ${limits.imageMaxMb} MB)`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      /\.hei[cf]$/i.test(file.name)
        ? `${file.name}: เบราว์เซอร์นี้เปิดไฟล์ HEIC ไม่ได้ ลองเปิดจาก Safari หรือแปลงเป็น JPG ก่อน`
        : `${file.name}: เปิดไฟล์รูปไม่ได้ ไฟล์อาจเสีย`
    );
  }
  try {
    const main = await encode(bitmap, limits.maxPx, 0.8);
    const thumb = await encode(bitmap, 320, 0.7);
    const stem = file.name.replace(/\.[^.]+$/, '');
    const ext = main.blob.type === 'image/webp' ? 'webp' : 'jpg';
    return {
      key,
      file_name: `${stem}.${ext}`,
      kind: 'IMAGE',
      data: await blobToDataUrl(main.blob),
      thumb: await blobToDataUrl(thumb.blob),
      preview: URL.createObjectURL(thumb.blob),
      original_size: file.size,
      size: main.blob.size,
      width: main.w,
      height: main.h,
    };
  } finally {
    bitmap.close();
  }
}

/** อัปโหลดทีละไฟล์ คืน attachment_id ที่สำเร็จ และข้อความ error ของไฟล์ที่ไม่สำเร็จ */
export async function uploadPrepared(ticketId: number, files: PreparedFile[], referenceType: 'TICKET' | 'STATUS' | 'PART') {
  const ids: number[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      const res = await api.post(`/api/repairs/${ticketId}/attachments`, {
        file_name: f.file_name, data: f.data, thumb: f.thumb, original_size: f.original_size,
        width: f.width, height: f.height, reference_type: referenceType,
      });
      ids.push(res.data.data.attachment_id);
    } catch (err) {
      errors.push(`${f.file_name}: ${(err as { response?: { data?: { message?: string } } }).response?.data?.message || 'อัปโหลดไม่สำเร็จ'}`);
    }
  }
  return { ids, errors };
}

export function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
