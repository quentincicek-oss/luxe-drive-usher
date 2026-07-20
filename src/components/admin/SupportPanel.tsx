import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  adminSupportReply, adminSupportSetStatus, adminUpdateSupportSettings,
} from "@/lib/support.functions";

type Conversation = {
  id: string; passenger_id: string; category: string; subject: string; status: string;
  assigned_admin_id: string | null; passenger_unread_count: number; admin_unread_count: number;
  updated_at: string;
};
type Message = { id: string; sender_type: string; body: string; is_internal_note: boolean; created_at: string };
type Settings = {
  whatsapp_enabled: boolean; whatsapp_phone_e164: string | null; whatsapp_template: string | null;
  email_enabled: boolean; email_address: string | null;
  operating_hours: string | null; emergency_message: string | null; fallback_message: string | null;
};

export function SupportPanel() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "pending" | "resolved">("open");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const replyFn = useServerFn(adminSupportReply);
  const statusFn = useServerFn(adminSupportSetStatus);
  const settingsFn = useServerFn(adminUpdateSupportSettings);

  const load = useCallback(async () => {
    setBusy(true);
    let q = supabase.from("support_conversations")
      .select("id, passenger_id, category, subject, status, assigned_admin_id, passenger_unread_count, admin_unread_count, updated_at")
      .order("updated_at", { ascending: false }).limit(200);
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setConvs((data ?? []) as Conversation[]);
    setBusy(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from("support_settings").select("*").eq("id", 1).maybeSingle()
      .then(({ data }) => setSettings(data as Settings | null));
  }, []);

  const openThread = async (c: Conversation) => {
    setSelected(c);
    const { data } = await supabase.from("support_messages")
      .select("id, sender_type, body, is_internal_note, created_at").eq("conversation_id", c.id)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
  };

  const reply = async () => {
    if (!selected || !draft.trim()) return;
    try {
      await replyFn({ data: { conversationId: selected.id, body: draft, internal } });
      setDraft(""); setInternal(false);
      await openThread(selected); load();
    } catch (e) { toast.error((e as Error).message); }
  };

  const setStatus = async (s: "open" | "pending" | "resolved") => {
    if (!selected) return;
    try {
      await statusFn({ data: { conversationId: selected.id, status: s } });
      toast.success(`Marked ${s}`); load();
      setSelected({ ...selected, status: s });
    } catch (e) { toast.error((e as Error).message); }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    try {
      const result = await settingsFn({ data: { payload: next } });
      setSettings(result as unknown as Settings);
      toast.success("Support settings saved");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <div className="flex gap-1">
          {(["open", "pending", "resolved", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={"px-3 py-1.5 text-xs rounded-full border " + (filter === f ? "border-gold text-gold" : "border-border/60 text-muted-foreground")}>
              {f}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-border/60 divide-y divide-border/40 max-h-[600px] overflow-y-auto">
          {busy && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
          {!busy && convs.length === 0 && <div className="p-4 text-xs text-muted-foreground">No conversations</div>}
          {convs.map((c) => (
            <button key={c.id} onClick={() => openThread(c)}
              className={"w-full text-left p-3 hover:bg-accent/40 " + (selected?.id === c.id ? "bg-accent/30" : "")}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm truncate">{c.subject}</div>
                {c.admin_unread_count > 0 && (
                  <span className="rounded-full bg-gold px-1.5 text-[10px] text-primary-foreground">{c.admin_unread_count}</span>
                )}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {c.category.replace(/_/g, " ")} · {c.status}
              </div>
            </button>
          ))}
        </div>

        {settings && (
          <div className="rounded-lg border border-border/60 p-3 space-y-2 text-xs">
            <div className="font-display text-sm text-gradient-gold">Support settings</div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.whatsapp_enabled}
                onChange={(e) => setSettings({ ...settings, whatsapp_enabled: e.target.checked })} />
              WhatsApp enabled
            </label>
            <input placeholder="+15551234567 (E.164)" value={settings.whatsapp_phone_e164 ?? ""}
              onChange={(e) => setSettings({ ...settings, whatsapp_phone_e164: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" />
            <input placeholder="WhatsApp prefilled message (optional)" value={settings.whatsapp_template ?? ""}
              onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={settings.email_enabled}
                onChange={(e) => setSettings({ ...settings, email_enabled: e.target.checked })} />
              Email enabled
            </label>
            <input placeholder="support@harborline.com" value={settings.email_address ?? ""}
              onChange={(e) => setSettings({ ...settings, email_address: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" />
            <input placeholder="Operating hours" value={settings.operating_hours ?? ""}
              onChange={(e) => setSettings({ ...settings, operating_hours: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" />
            <input placeholder="Emergency message (911, etc.)" value={settings.emergency_message ?? ""}
              onChange={(e) => setSettings({ ...settings, emergency_message: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" />
            <textarea placeholder="Fallback message" value={settings.fallback_message ?? ""}
              onChange={(e) => setSettings({ ...settings, fallback_message: e.target.value })}
              className="w-full rounded border border-border/60 bg-input px-2 py-1" rows={2} />
            <button onClick={() => saveSettings({})}
              className="w-full rounded-md bg-gold-gradient py-1.5 text-primary-foreground">Save settings</button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-surface/30 min-h-[400px] flex flex-col">
        {!selected && <div className="grid place-items-center flex-1 text-sm text-muted-foreground">Select a conversation</div>}
        {selected && (
          <>
            <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-display text-base">{selected.subject}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {selected.category.replace(/_/g, " ")} · {selected.status}
                </div>
              </div>
              <div className="flex gap-1">
                {(["open", "pending", "resolved"] as const).map((s) => (
                  <button key={s} onClick={() => setStatus(s)}
                    className="text-[10px] uppercase tracking-widest px-2 py-1 border border-border/60 rounded hover:border-gold/60">
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((m) => (
                <div key={m.id} className={"flex " + (m.sender_type === "admin" ? "justify-end" : "justify-start")}>
                  <div className={
                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm " +
                    (m.is_internal_note ? "bg-amber-500/10 border border-amber-500/30 text-amber-100"
                      : m.sender_type === "admin" ? "bg-gold-gradient text-primary-foreground"
                      : "bg-accent border border-border/40")
                  }>
                    {m.is_internal_note && <div className="text-[9px] uppercase tracking-widest mb-1 opacity-80">Internal note</div>}
                    {m.body}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border/40 p-3 space-y-2">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                rows={2} maxLength={4000}
                placeholder={internal ? "Internal note (passenger cannot see)" : "Reply to passenger"}
                className="w-full rounded-md border border-border/60 bg-input px-3 py-2 text-sm" />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  Internal note
                </label>
                <button onClick={reply} disabled={!draft.trim()}
                  className="rounded-md bg-gold-gradient px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  {internal ? "Add note" : "Send reply"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
