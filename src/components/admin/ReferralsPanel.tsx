import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DispatchKpi } from "@/components/ops/DispatchKpi";
import { StatusPill } from "@/components/ops/StatusPill";
import { toast } from "sonner";

interface Campaign {
  id: string; name: string; description: string | null;
  reward_percent: number; reward_flat_amount: number | null;
  reward_validity_days: number; per_referrer_limit: number | null;
  starts_at: string; ends_at: string | null; active: boolean;
}
interface NfcTag { id: string; tag_uid: string; code_id: string; label: string | null; active: boolean; tap_count: number; last_tapped_at: string | null; }
interface ReferralRow { id: string; referrer_user_id: string; referred_user_id: string | null; source: string; status: string; created_at: string; campaign_id: string | null; }
interface RewardRow { id: string; recipient_user_id: string; status: string; amount_percent: number | null; amount_flat: number | null; expires_at: string | null; issued_at: string; }
interface Kpis {
  total_referrals: number; converted_referrals: number; pending_referrals: number;
  conversion_rate: number; pending_rewards: number; redeemed_rewards: number;
  active_campaigns: number; nfc_tags_active: number;
  top_referrers: { user_id: string; name: string; total: number; converted: number }[];
  top_drivers: { user_id: string; name: string; total: number; converted: number }[];
}

export function ReferralsPanel() {
  const [tab, setTab] = useState<"overview"|"campaigns"|"nfc"|"activity">("overview");
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<NfcTag[]>([]);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [rewards, setRewards] = useState<RewardRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [editingCamp, setEditingCamp] = useState<Partial<Campaign> | null>(null);
  const [editingTag, setEditingTag] = useState<Partial<NfcTag> & { code_id?: string } | null>(null);

  async function refresh() {
    setBusy(true);
    const [k, c, n, r, rw] = await Promise.all([
      (supabase as any).rpc("admin_referral_kpis"),
      (supabase as any).from("referral_campaigns").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("nfc_tags").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("referrals").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("referral_rewards").select("*").order("issued_at", { ascending: false }).limit(200),
    ]);
    setKpis(k.data ?? null);
    setCampaigns((c.data ?? []) as Campaign[]);
    setTags((n.data ?? []) as NfcTag[]);
    setReferrals((r.data ?? []) as ReferralRow[]);
    setRewards((rw.data ?? []) as RewardRow[]);
    setBusy(false);
  }
  useEffect(() => { refresh(); }, []);

  async function saveCampaign() {
    if (!editingCamp?.name) { toast.error("Name required"); return; }
    const payload: any = {
      name: editingCamp.name,
      description: editingCamp.description ?? null,
      reward_percent: editingCamp.reward_percent ?? 10,
      reward_flat_amount: editingCamp.reward_flat_amount ?? null,
      reward_validity_days: editingCamp.reward_validity_days ?? 90,
      per_referrer_limit: editingCamp.per_referrer_limit ?? null,
      starts_at: editingCamp.starts_at ?? new Date().toISOString(),
      ends_at: editingCamp.ends_at || null,
      active: editingCamp.active ?? true,
    };
    const q = editingCamp.id
      ? (supabase as any).from("referral_campaigns").update(payload).eq("id", editingCamp.id)
      : (supabase as any).from("referral_campaigns").insert(payload);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    toast.success("Campaign saved"); setEditingCamp(null); refresh();
  }
  async function toggleCampaign(c: Campaign) {
    const { error } = await (supabase as any).from("referral_campaigns").update({ active: !c.active }).eq("id", c.id);
    if (error) return toast.error(error.message);
    refresh();
  }
  async function deleteCampaign(id: string) {
    if (!confirm("Delete campaign?")) return;
    const { error } = await (supabase as any).from("referral_campaigns").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  }

  async function saveTag() {
    if (!editingTag?.tag_uid || !editingTag.code_id) { toast.error("Tag UID and code required"); return; }
    const payload: any = { tag_uid: editingTag.tag_uid, code_id: editingTag.code_id, label: editingTag.label ?? null, active: editingTag.active ?? true };
    const q = editingTag.id
      ? (supabase as any).from("nfc_tags").update(payload).eq("id", editingTag.id)
      : (supabase as any).from("nfc_tags").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success("NFC tag saved"); setEditingTag(null); refresh();
  }
  async function deleteTag(id: string) {
    if (!confirm("Delete NFC tag?")) return;
    const { error } = await (supabase as any).from("nfc_tags").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  }

  const codeOptions = useMemo(() =>
    tags.length > 0 ? tags.map(t => ({ id: t.code_id })) : [], [tags]);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border/40">
        {(["overview","campaigns","nfc","activity"] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={"px-3 py-2 text-xs uppercase tracking-widest transition border-b-2 " +
              (tab === k ? "border-gold text-gold" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {k}
          </button>
        ))}
      </div>

      {busy && <div className="text-muted-foreground text-sm">Loading…</div>}

      {tab === "overview" && !busy && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DispatchKpi label="Total referrals"   value={kpis?.total_referrals ?? 0} tone="gold" />
            <DispatchKpi label="Converted"         value={kpis?.converted_referrals ?? 0} tone="emerald" />
            <DispatchKpi label="Conversion rate"   value={`${kpis?.conversion_rate ?? 0}%`} tone="sky" />
            <DispatchKpi label="Pending"           value={kpis?.pending_referrals ?? 0} tone="amber" />
            <DispatchKpi label="Pending rewards"   value={kpis?.pending_rewards ?? 0} tone="amber" />
            <DispatchKpi label="Redeemed rewards"  value={kpis?.redeemed_rewards ?? 0} tone="emerald" />
            <DispatchKpi label="Active campaigns"  value={kpis?.active_campaigns ?? 0} />
            <DispatchKpi label="NFC tags active"   value={kpis?.nfc_tags_active ?? 0} tone="gold" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <LeaderBoard title="Top referrers" rows={kpis?.top_referrers ?? []} />
            <LeaderBoard title="Top drivers"   rows={kpis?.top_drivers ?? []} />
          </div>
        </div>
      )}

      {tab === "campaigns" && !busy && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">{campaigns.length} campaigns · Admins manage reward %, validity, periods & limits</div>
            <button onClick={() => setEditingCamp({ reward_percent: 10, reward_validity_days: 90, active: true })}
              className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ New Campaign</button>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {campaigns.map(c => (
              <div key={c.id} className="rounded-lg border border-border/60 bg-surface p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-lg text-gradient-gold">{c.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{c.description || "—"}</div>
                  </div>
                  <StatusPill tone={(c.active ? "active" : "cancelled") as any}>{c.active ? "Active" : "Off"}</StatusPill>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Reward</span><div className="text-gold">{c.reward_percent}%{c.reward_flat_amount ? ` + $${c.reward_flat_amount}` : ""}</div></div>
                  <div><span className="text-muted-foreground">Validity</span><div>{c.reward_validity_days}d</div></div>
                  <div><span className="text-muted-foreground">Starts</span><div>{new Date(c.starts_at).toLocaleDateString()}</div></div>
                  <div><span className="text-muted-foreground">Ends</span><div>{c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "—"}</div></div>
                  <div><span className="text-muted-foreground">Limit / referrer</span><div>{c.per_referrer_limit ?? "∞"}</div></div>
                </div>
                <div className="mt-4 flex gap-3 text-xs">
                  <button onClick={() => setEditingCamp(c)} className="text-gold hover:underline">Edit</button>
                  <button onClick={() => toggleCampaign(c)} className="text-muted-foreground hover:text-foreground">{c.active ? "Deactivate" : "Activate"}</button>
                  <button onClick={() => deleteCampaign(c.id)} className="text-destructive hover:underline ml-auto">Delete</button>
                </div>
              </div>
            ))}
            {campaigns.length === 0 && <div className="text-muted-foreground text-sm">No campaigns yet.</div>}
          </div>
        </div>
      )}

      {tab === "nfc" && !busy && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">NFC is a first-class share surface. Each tag maps to a referral code.</div>
            <button onClick={() => setEditingTag({ active: true })}
              className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground shadow-gold">+ New NFC Tag</button>
          </div>
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Tag UID</th>
                  <th className="text-left px-4 py-3">Label</th>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Taps</th>
                  <th className="text-left px-4 py-3">Last tap</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {tags.map(t => (
                  <tr key={t.id} className="border-t border-border/40 hover:bg-accent/40">
                    <td className="px-4 py-3 font-mono text-xs">{t.tag_uid}</td>
                    <td className="px-4 py-3">{t.label ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{t.code_id.slice(0,8)}…</td>
                    <td className="px-4 py-3 tabular-nums">{t.tap_count}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.last_tapped_at ? new Date(t.last_tapped_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3"><StatusPill tone={(t.active ? "active" : "cancelled") as any}>{t.active ? "Active" : "Off"}</StatusPill></td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditingTag(t)} className="text-xs text-gold hover:underline mr-3">Edit</button>
                      <button onClick={() => deleteTag(t.id)} className="text-xs text-destructive hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
                {tags.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No NFC tags</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "activity" && !busy && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h4 className="font-display text-lg mb-3">Recent referrals</h4>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface uppercase tracking-widest text-[10px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.slice(0,50).map(r => (
                    <tr key={r.id} className="border-t border-border/40">
                      <td className="px-3 py-2 tabular-nums">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 uppercase">{r.source}</td>
                      <td className="px-3 py-2"><StatusPill tone={(r.status === "converted" || r.status === "rewarded" ? "completed" : r.status === "cancelled" ? "cancelled" : "pending") as any}>{r.status}</StatusPill></td>
                    </tr>
                  ))}
                  {referrals.length === 0 && <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">No referrals</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="font-display text-lg mb-3">Rewards ledger</h4>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface uppercase tracking-widest text-[10px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Issued</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Expires</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.slice(0,50).map(r => (
                    <tr key={r.id} className="border-t border-border/40">
                      <td className="px-3 py-2 tabular-nums">{new Date(r.issued_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-gold">{r.amount_percent ? `${r.amount_percent}%` : ""}{r.amount_flat ? ` $${r.amount_flat}` : ""}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2"><StatusPill tone={(r.status === "redeemed" ? "completed" : r.status === "cancelled" || r.status === "expired" ? "cancelled" : "pending") as any}>{r.status}</StatusPill></td>
                    </tr>
                  ))}
                  {rewards.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No rewards</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {editingCamp && (
        <Modal title={editingCamp.id ? "Edit campaign" : "New campaign"} onClose={() => setEditingCamp(null)}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Name *" value={editingCamp.name ?? ""} onChange={v => setEditingCamp({ ...editingCamp, name: v })} />
            <Input label="Reward %" type="number" value={String(editingCamp.reward_percent ?? 10)} onChange={v => setEditingCamp({ ...editingCamp, reward_percent: Number(v) })} />
            <Input label="Flat reward $" type="number" value={String(editingCamp.reward_flat_amount ?? "")} onChange={v => setEditingCamp({ ...editingCamp, reward_flat_amount: v ? Number(v) : null })} />
            <Input label="Validity (days)" type="number" value={String(editingCamp.reward_validity_days ?? 90)} onChange={v => setEditingCamp({ ...editingCamp, reward_validity_days: Number(v) })} />
            <Input label="Per-referrer limit" type="number" value={String(editingCamp.per_referrer_limit ?? "")} onChange={v => setEditingCamp({ ...editingCamp, per_referrer_limit: v ? Number(v) : null })} />
            <Input label="Starts" type="datetime-local" value={editingCamp.starts_at ? new Date(editingCamp.starts_at).toISOString().slice(0,16) : ""} onChange={v => setEditingCamp({ ...editingCamp, starts_at: v ? new Date(v).toISOString() : undefined })} />
            <Input label="Ends" type="datetime-local" value={editingCamp.ends_at ? new Date(editingCamp.ends_at).toISOString().slice(0,16) : ""} onChange={v => setEditingCamp({ ...editingCamp, ends_at: v ? new Date(v).toISOString() : null })} />
            <div className="sm:col-span-2">
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Description</label>
              <textarea rows={2} value={editingCamp.description ?? ""} onChange={e => setEditingCamp({ ...editingCamp, description: e.target.value })}
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
            </div>
            <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editingCamp.active ?? true} onChange={e => setEditingCamp({ ...editingCamp, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditingCamp(null)} className="rounded-full px-4 py-2 text-sm text-muted-foreground">Cancel</button>
            <button onClick={saveCampaign} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}

      {editingTag && (
        <Modal title={editingTag.id ? "Edit NFC tag" : "New NFC tag"} onClose={() => setEditingTag(null)}>
          <div className="grid gap-3">
            <Input label="Tag UID *" value={editingTag.tag_uid ?? ""} onChange={v => setEditingTag({ ...editingTag, tag_uid: v })} />
            <Input label="Label" value={editingTag.label ?? ""} onChange={v => setEditingTag({ ...editingTag, label: v })} />
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Referral code ID *</label>
              <input value={editingTag.code_id ?? ""} onChange={e => setEditingTag({ ...editingTag, code_id: e.target.value })}
                placeholder="paste referral_codes.id UUID"
                className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm font-mono" />
              <div className="mt-1 text-[11px] text-muted-foreground">Existing codes referenced: {codeOptions.length}</div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editingTag.active ?? true} onChange={e => setEditingTag({ ...editingTag, active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setEditingTag(null)} className="rounded-full px-4 py-2 text-sm text-muted-foreground">Cancel</button>
            <button onClick={saveTag} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LeaderBoard({ title, rows }: { title: string; rows: { user_id: string; name: string; total: number; converted: number }[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface/60 p-5">
      <h4 className="font-display text-lg mb-3">{title}</h4>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-xs text-muted-foreground">No data yet</div>}
        {rows.map((r, i) => (
          <div key={r.user_id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <span className="w-5 text-xs text-muted-foreground tabular-nums">{i+1}</span>
              <span className="truncate">{r.name}</span>
            </div>
            <div className="text-xs tabular-nums">
              <span className="text-gold">{r.converted}</span>
              <span className="text-muted-foreground"> / {r.total}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-surface p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-xl">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
    </div>
  );
}
