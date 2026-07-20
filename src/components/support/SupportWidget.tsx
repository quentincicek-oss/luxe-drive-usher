import { useEffect, useState, useCallback } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { LifeBuoy, Send, X, MessageCircle, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  supportOpenConversation, supportSendMessage, supportMarkRead,
} from "@/lib/support.functions";

type Conversation = {
  id: string; subject: string; category: string; status: string;
  passenger_unread_count: number; updated_at: string;
};
type Message = { id: string; sender_type: string; body: string; created_at: string };
type Settings = {
  whatsapp_enabled: boolean; whatsapp_phone_e164: string | null; whatsapp_template: string | null;
  email_enabled: boolean; email_address: string | null;
  operating_hours: string | null; emergency_message: string | null; fallback_message: string | null;
};

const CATEGORIES: { code: string; label: string }[] = [
  { code: "booking_help", label: "Booking help" },
  { code: "driver_concern", label: "Driver concern" },
  { code: "payment_receipt", label: "Payment / receipt" },
  { code: "lost_item", label: "Lost item" },
  { code: "safety_concern", label: "Safety concern" },
  { code: "vehicle_preference", label: "Vehicle preference" },
  { code: "amenity_question", label: "Drink / amenity question" },
  { code: "technical_problem", label: "Technical problem" },
  { code: "general_support", label: "General support" },
];

export function SupportWidget() {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general_support");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiFailed, setApiFailed] = useState(false);

  const openFn = useServerFn(supportOpenConversation);
  const sendFn = useServerFn(supportSendMessage);
  const readFn = useServerFn(supportMarkRead);

  const loadConvs = useCallback(async () => {
    setBusy(true); setApiFailed(false);
    const { data, error } = await supabase.from("support_conversations")
      .select("id, subject, category, status, passenger_unread_count, updated_at")
      .order("updated_at", { ascending: false }).limit(50);
    if (error) setApiFailed(true);
    else setConvs((data ?? []) as Conversation[]);
    setBusy(false);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const { data } = await supabase.from("support_messages")
      .select("id, sender_type, body, created_at").eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
    try { await readFn({ data: { conversationId: id } }); } catch { /* ignore */ }
  }, [readFn]);

  useEffect(() => {
    if (!open || !user) return;
    loadConvs();
    supabase.from("support_settings").select("*").eq("id", 1).maybeSingle()
      .then(({ data }) => setSettings(data as Settings | null));
  }, [open, user, loadConvs]);

  if (loading || !user) return null;
  if (pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/admin")) return null;

  async function submitNew() {
    if (!subject.trim() || !draft.trim()) return;
    setBusy(true);
    try {
      const id = await openFn({ data: { category, subject, firstMessage: draft, bookingId: null } });
      setSubject(""); setDraft(""); setCategory("general_support");
      setThreadId(id as unknown as string);
      await loadMessages(id as unknown as string);
      setView("thread");
      await loadConvs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open request");
    } finally { setBusy(false); }
  }

  async function sendMsg() {
    if (!threadId || !draft.trim()) return;
    setBusy(true);
    try {
      await sendFn({ data: { conversationId: threadId, body: draft } });
      setDraft("");
      await loadMessages(threadId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally { setBusy(false); }
  }

  const waHref = settings?.whatsapp_enabled && settings.whatsapp_phone_e164
    ? `https://wa.me/${encodeURIComponent(settings.whatsapp_phone_e164.replace(/^\+/, ""))}${
        settings.whatsapp_template ? `?text=${encodeURIComponent(settings.whatsapp_template)}` : ""
      }`
    : null;
  const mailHref = settings?.email_enabled && settings.email_address
    ? `mailto:${encodeURIComponent(settings.email_address)}?subject=${encodeURIComponent("HarborLine support")}`
    : null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-4 sm:left-6 z-40 flex items-center gap-2 rounded-full border border-border/60 bg-obsidian/90 px-4 py-2.5 text-sm backdrop-blur hover:border-gold/60 shadow-luxe"
          aria-label="Open support"
        >
          <LifeBuoy className="h-4 w-4 text-gold" />
          <span className="hidden sm:inline">Support</span>
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 left-6 z-50 w-[min(400px,calc(100vw-2rem))] h-[min(600px,calc(100vh-4rem))] flex flex-col rounded-2xl border border-border/60 bg-obsidian shadow-luxe overflow-hidden">
          <div className="border-b border-border/60 px-4 py-3 flex items-center gap-3 bg-background/60">
            <LifeBuoy className="h-5 w-5 text-gold" />
            <div className="flex-1 min-w-0">
              <div className="font-display text-base">HarborLine Support</div>
              <div className="text-[10px] tracking-widest text-muted-foreground uppercase">
                {settings?.operating_hours ?? "We reply as quickly as possible"}
              </div>
            </div>
            <button onClick={() => { setOpen(false); setView("list"); setThreadId(null); }}
              className="rounded-md p-1.5 hover:bg-accent" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {view === "list" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <button onClick={() => setView("new")}
                className="w-full rounded-lg bg-gold-gradient px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-gold">
                + New request
              </button>
              {apiFailed && (
                <FallbackPanel waHref={waHref} mailHref={mailHref} settings={settings} />
              )}
              {!apiFailed && !busy && convs.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-6">No requests yet.</p>
              )}
              {convs.map((c) => (
                <button key={c.id}
                  onClick={async () => { setThreadId(c.id); await loadMessages(c.id); setView("thread"); }}
                  className="w-full text-left rounded-lg border border-border/60 bg-surface/40 p-3 hover:border-gold/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate">{c.subject}</div>
                    {c.passenger_unread_count > 0 && (
                      <span className="rounded-full bg-gold px-1.5 text-[10px] text-primary-foreground">
                        {c.passenger_unread_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.category.replace(/_/g, " ")} · {c.status}
                  </div>
                </button>
              ))}
              {(waHref || mailHref) && !apiFailed && (
                <div className="pt-3 border-t border-border/40 mt-3">
                  <FallbackPanel waHref={waHref} mailHref={mailHref} settings={settings} />
                </div>
              )}
            </div>
          )}

          {view === "new" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <button onClick={() => setView("list")} className="text-xs text-muted-foreground">← Back</button>
              <div>
                <div className="label-luxe">Category</div>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm">
                  {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <div className="label-luxe">Subject</div>
                <input value={subject} onChange={(e) => setSubject(e.target.value)}
                  maxLength={200} placeholder="Brief subject"
                  className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
              </div>
              <div>
                <div className="label-luxe">Message</div>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                  rows={5} maxLength={4000}
                  className="w-full rounded-lg border border-border/60 bg-input px-3 py-2 text-sm" />
              </div>
              <button onClick={submitNew} disabled={busy || !subject.trim() || !draft.trim()}
                className="w-full rounded-lg bg-gold-gradient px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                Send request
              </button>
            </div>
          )}

          {view === "thread" && (
            <>
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
                <button onClick={() => { setView("list"); setThreadId(null); }} className="text-xs text-muted-foreground">← Back</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={"flex " + (m.sender_type === "passenger" ? "justify-end" : "justify-start")}>
                    <div className={"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm " + (
                      m.sender_type === "passenger" ? "bg-gold-gradient text-primary-foreground"
                        : m.sender_type === "system" ? "bg-muted/40 text-muted-foreground text-xs"
                        : "bg-accent border border-border/40"
                    )}>
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border/60 p-2.5 flex gap-2">
                <input value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMsg(); } }}
                  placeholder="Type your message"
                  className="flex-1 rounded-md border border-border/60 bg-input px-3 py-2 text-sm" />
                <button onClick={sendMsg} disabled={busy || !draft.trim()}
                  className="rounded-md bg-gold-gradient px-3.5 disabled:opacity-50">
                  <Send className="h-4 w-4 text-primary-foreground" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function FallbackPanel({
  waHref, mailHref, settings,
}: { waHref: string | null; mailHref: string | null; settings: Settings | null }) {
  if (!waHref && !mailHref) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Alternate channels</div>
      {settings?.fallback_message && (
        <div className="text-xs text-muted-foreground mb-2">{settings.fallback_message}</div>
      )}
      <div className="flex flex-wrap gap-2">
        {waHref && (
          <a href={waHref} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs hover:border-gold/60">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
        {mailHref && (
          <a href={mailHref}
             className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs hover:border-gold/60">
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        )}
      </div>
      {settings?.emergency_message && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <Phone className="h-3 w-3 mt-0.5" /> <span>{settings.emergency_message}</span>
        </div>
      )}
    </div>
  );
}
