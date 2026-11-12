import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/card';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { toast } from '@repo/ui/use-toast';
import api, { errorMessage } from '../lib/api';
import { STATUS_LABEL, URGENCY_LABEL } from '../lib/repair';
import { fmtDateTimeTH } from '../lib/format';
import { useAuth } from '../contexts/AuthContext';

interface Setting { setting_key: string; setting_value: string; value_type: string; description: string | null; modify_by_name: string | null; modify_date: string | null }
interface SlaRule { sla_rule_id: number; status: string; urgency: string | null; asset_type: string | null; warn_after_hours: number; is_active: boolean }

const RepairSettings: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('repair.settings');
  const [settings, setSettings] = useState<Setting[]>([]);
  const [rules, setRules] = useState<SlaRule[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ruleDraft, setRuleDraft] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get('/api/repair-settings'), api.get('/api/repair-sla-rules')]);
      setSettings(s.data.data);
      setRules(r.data.data);
      setDraft(Object.fromEntries(s.data.data.map((x: Setting) => [x.setting_key, x.setting_value])));
      setRuleDraft(Object.fromEntries(r.data.data.map((x: SlaRule) => [x.sla_rule_id, String(x.warn_after_hours)])));
    } catch (err) {
      toast({ title: errorMessage(err, 'โหลดค่าตั้งไม่สำเร็จ'), variant: 'destructive' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changedSettings = settings.filter((s) => draft[s.setting_key] !== s.setting_value);
  const changedRules = rules.filter((r) => {
    const d = ruleDraft[r.sla_rule_id];
    return d !== undefined && Number(d) !== r.warn_after_hours;
  });
  const dirty = changedSettings.length + changedRules.length;

  const save = async () => {
    if (!reason.trim()) return toast({ title: 'กรุณาระบุเหตุผลการแก้ไข', variant: 'destructive' });
    setSaving(true);
    try {
      for (const s of changedSettings) {
        await api.patch(`/api/repair-settings/${s.setting_key}`, { value: draft[s.setting_key], reason });
      }
      for (const r of changedRules) {
        await api.put(`/api/repair-sla-rules/${r.sla_rule_id}`, {
          warn_after_hours: Number(ruleDraft[r.sla_rule_id]), is_active: r.is_active, reason,
        });
      }
      toast({ title: `บันทึก ${dirty} รายการแล้ว และเก็บในประวัติการตั้งค่า` });
      setReason('');
      load();
    } catch (err) {
      toast({ title: errorMessage(err, 'บันทึกไม่สำเร็จ'), variant: 'destructive' });
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">ตั้งค่าระบบ</h1>
        <p className="text-sm text-slate-500">ทุกการบันทึกต้องระบุเหตุผล{!canEdit && ' · คุณดูได้อย่างเดียว'}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">เวลาที่กำหนด (SLA) — หน่วยชั่วโมง</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[360px]">
                <TableHeader className="bg-slate-100">
                  <TableRow><TableHead>สถานะ</TableHead><TableHead className="w-32">เตือนเมื่อค้างเกิน</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.sla_rule_id}>
                      <TableCell className="text-sm">
                        {STATUS_LABEL[r.status] || r.status}
                        {r.urgency && <span className="text-xs text-red-600"> · {URGENCY_LABEL[r.urgency]}</span>}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min="0.5" step="0.5" disabled={!canEdit} className="h-8"
                          aria-label={`เวลาเตือน ${STATUS_LABEL[r.status] || r.status}`}
                          value={ruleDraft[r.sla_rule_id] ?? ''}
                          onChange={(e) => setRuleDraft({ ...ruleDraft, [r.sla_rule_id]: e.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">ค่าตั้งทั่วไป</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {settings.map((s) => (
              <div key={s.setting_key} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3">
                <div className="min-w-0">
                  <Label htmlFor={s.setting_key} className="text-sm">{s.description || s.setting_key}</Label>
                  <p className="truncate font-mono text-xs text-slate-400">
                    {s.setting_key}{s.modify_date && ` · แก้ล่าสุด ${fmtDateTimeTH(s.modify_date)} โดย ${s.modify_by_name}`}
                  </p>
                </div>
                <Input id={s.setting_key} className="h-8" disabled={!canEdit}
                  type={s.value_type === 'NUMBER' ? 'number' : 'text'}
                  value={draft[s.setting_key] ?? ''} onChange={(e) => setDraft({ ...draft, [s.setting_key]: e.target.value })} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {canEdit && (
        <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <Label htmlFor="reason">เหตุผลการแก้ไข (บังคับ)</Label>
            <Input id="reason" placeholder="เช่น ตามมติที่ประชุม 4/2569" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving || dirty === 0} className="bg-teal-700 hover:bg-teal-800">
            {saving ? 'กำลังบันทึก...' : `บันทึก${dirty ? ` (${dirty} รายการ)` : ''}`}
          </Button>
        </CardContent></Card>
      )}
    </div>
  );
};

export default RepairSettings;
