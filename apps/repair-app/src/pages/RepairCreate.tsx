import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Textarea } from '@repo/ui/textarea';
import { Card, CardContent } from '@repo/ui/card';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { ASSET_TYPE_LABEL, STATUS_LABEL, type AssetType } from '../lib/repair';
import { fmtDateTimeTH } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';

interface AssetOption {
  asset_id: number;
  asset_code: string;
  name: string;
  location: string | null;
  department_name: string | null;
  asset_type: AssetType;
  open_ticket_no: string | null;
}

interface OpenTicket {
  ticket_id: number;
  ticket_no: string;
  status: string;
  title: string;
  description: string | null;
  created_date: string;
  requester_name: string;
}

const RepairCreate: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetQ, setAssetQ] = useState('');
  const [assetId, setAssetId] = useState<string>('');
  const [noAsset, setNoAsset] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>('GENERAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('NORMAL');
  const [location, setLocation] = useState('');
  const [openTickets, setOpenTickets] = useState<OpenTicket[]>([]);
  const [dupMode, setDupMode] = useState<'none' | 'new'>('none');
  const [dupReason, setDupReason] = useState('');
  const [saving, setSaving] = useState(false);

  const requestTypes = (Object.keys(ASSET_TYPE_LABEL) as AssetType[]).filter((t) =>
    hasPermission(`repair.${t.toLowerCase()}.request`) || hasPermission('repair.all')
  );

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/api/repair-assets', { params: { q: assetQ } })
        .then((res) => setAssets(res.data.data))
        .catch((err) => toast({ title: errorMessage(err, 'โหลดครุภัณฑ์ไม่สำเร็จ'), variant: 'destructive' }));
    }, 250);
    return () => clearTimeout(t);
  }, [assetQ]);

  const selected = assets.find((a) => String(a.asset_id) === assetId);

  useEffect(() => {
    setOpenTickets([]);
    setDupMode('none');
    setDupReason('');
    if (!assetId) return;
    api.get(`/api/assets/${assetId}/open-repairs`)
      .then((res) => setOpenTickets(res.data.data))
      .catch(() => undefined);
  }, [assetId]);

  useEffect(() => {
    if (selected) setLocation(selected.location || '');
  }, [selected]);

  const watchExisting = async () => {
    const t = openTickets[0];
    try {
      await api.post(`/api/repairs/${t.ticket_id}/watchers`, { source: 'DUPLICATE', note: description });
      toast({ title: `เพิ่มคุณเป็นผู้ติดตาม ${t.ticket_no} แล้ว` });
      navigate(`/repairs/${t.ticket_id}`);
    } catch (err) {
      toast({ title: errorMessage(err, 'ติดตามใบเดิมไม่สำเร็จ'), variant: 'destructive' });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noAsset && !assetId) return toast({ title: 'กรุณาเลือกครุภัณฑ์ หรือเลือก "ไม่มีรหัสครุภัณฑ์"', variant: 'destructive' });
    if (noAsset && !title.trim()) return toast({ title: 'กรุณาระบุชื่อสิ่งของที่แจ้งซ่อม', variant: 'destructive' });
    if (!description.trim()) return toast({ title: 'กรุณาระบุอาการเสีย', variant: 'destructive' });
    if (openTickets.length > 0 && (dupMode !== 'new' || !dupReason.trim())) {
      return toast({ title: 'เครื่องนี้มีใบซ่อมค้างอยู่ กรุณาติดตามใบเดิม หรือกรอกเหตุผลที่แจ้งใหม่', variant: 'destructive' });
    }
    setSaving(true);
    try {
      const res = await api.post('/api/repairs', {
        asset_id: noAsset ? null : Number(assetId),
        asset_type: noAsset ? assetType : undefined,
        title: noAsset ? title : undefined,
        description,
        urgency,
        location,
        duplicate_of_ticket_id: openTickets.length > 0 ? openTickets[0].ticket_id : undefined,
        duplicate_reason: openTickets.length > 0 ? dupReason : undefined,
      });
      toast({ title: `สร้างใบแจ้งซ่อม ${res.data.data.ticket_no} แล้ว` });
      navigate(`/repairs/${res.data.data.ticket_id}`);
    } catch (err) {
      const data = (err as { response?: { data?: { code?: string; open_tickets?: OpenTicket[] } } }).response?.data;
      if (data?.code === 'OPEN_TICKET_EXISTS' && data.open_tickets) setOpenTickets(data.open_tickets);
      toast({ title: errorMessage(err, 'สร้างใบแจ้งซ่อมไม่สำเร็จ'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">แจ้งซ่อม</h1>
        <p className="text-sm text-slate-500">ระบบจะตรวจว่าเครื่องนี้มีใบซ่อมที่ยังไม่ปิดหรือไม่ก่อนส่ง</p>
      </div>
      <Card>
        <CardContent className="p-5">
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="assetQ">ครุภัณฑ์</Label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={noAsset} onChange={(e) => { setNoAsset(e.target.checked); setAssetId(''); }} />
                ไม่มีรหัสครุภัณฑ์ (กรอกชื่อสิ่งของเอง)
              </label>
              {!noAsset && (
                <>
                  <Input id="assetQ" placeholder="ค้นหารหัสหรือชื่อครุภัณฑ์" value={assetQ} onChange={(e) => setAssetQ(e.target.value)} />
                  <select
                    className="h-10 w-full rounded-md border px-2 text-sm"
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                    aria-label="เลือกครุภัณฑ์"
                  >
                    <option value="">— เลือกครุภัณฑ์ ({assets.length} รายการ) —</option>
                    {assets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        {a.asset_code} · {a.name} ({ASSET_TYPE_LABEL[a.asset_type]}){a.open_ticket_no ? ` · ค้าง ${a.open_ticket_no}` : ''}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {openTickets.length > 0 && (
              <div className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4 md:col-span-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-900">เครื่องนี้มีใบซ่อมค้างอยู่แล้ว {openTickets[0].ticket_no}</p>
                    <p className="text-sm text-amber-900/80">
                      สถานะ: {STATUS_LABEL[openTickets[0].status]} · แจ้งโดย {openTickets[0].requester_name} เมื่อ{' '}
                      {fmtDateTimeTH(openTickets[0].created_date)}
                      {openTickets[0].description && ` · "${openTickets[0].description}"`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={watchExisting} className="bg-teal-700 hover:bg-teal-800">ติดตามใบเดิม</Button>
                  <Button type="button" variant="outline" onClick={() => setDupMode('new')}>แจ้งใหม่ (อาการต่างกัน)</Button>
                </div>
                {dupMode === 'new' && (
                  <div className="space-y-1">
                    <Label htmlFor="dupReason">เหตุผลที่แจ้งใหม่ (บังคับ)</Label>
                    <Input id="dupReason" value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder="อธิบายว่าอาการต่างจากใบเดิมอย่างไร" autoFocus />
                  </div>
                )}
              </div>
            )}

            {noAsset && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="title">ชื่อสิ่งของ *</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="assetType">ประเภทงาน</Label>
                  <select id="assetType" className="h-10 w-full rounded-md border px-2 text-sm" value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
                    {requestTypes.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label htmlFor="urgency">ความเร่งด่วน</Label>
              <select id="urgency" className="h-10 w-full rounded-md border px-2 text-sm" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                <option value="LOW">ต่ำ</option>
                <option value="NORMAL">ปกติ</option>
                <option value="HIGH">สูง</option>
                <option value="CRITICAL">วิกฤต</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="location">สถานที่ตั้ง</Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="description">อาการเสีย *</Label>
              <Textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <p className="text-xs text-slate-500 md:col-span-2">
              การแนบรูป/PDF จะเปิดใช้ในรอบถัดไป (ต้องเพิ่มไลบรารีย่อรูปฝั่ง backend)
            </p>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={saving} className="bg-teal-700 hover:bg-teal-800">
                {saving ? 'กำลังส่ง...' : 'ส่งใบแจ้งซ่อม'}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>ยกเลิก</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default RepairCreate;
