import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { HarborLogo } from "@/components/HarborLogo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { toast } from "sonner";
import { Send, LogOut, History, User as UserIcon, ShieldCheck } from "lucide-react";
import { VehicleShowroom } from "@/components/VehicleShowroom";
import { SiriOrb } from "@/components/SiriOrb";

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Reserve a Ride — HarborLine Executive Services" },
      { name: "description", content: "Book your chauffeured SUV or chat with Blake, our AI concierge." },
    ],
  }),
  component: Book,
});

type ChatMsg = { role: "user" | "assistant"; content: string };

const AGENT_ROLES: Record<string, string> = {
  Blake: "Head Concierge",
  Ava: "Reservations Lead",
  Marcus: "Airport Specialist",
  Sophia: "Events & VIP Liaison",
  Julian: "Route Advisor",
};

function Book() {
  const { user, role, loading, signOut } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [agent, setAgent] = useState<string>("Blake");
  const [form, setForm] = useState({
    pickup: "", dropoff: "",
    pickup_time: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
    passengers: 1, ride_type: "escalade" as "escalade" | "suburban" | "denali",
  });
  const [saving, setSaving] = useState(false);

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);
  useEffect(() => { document.title = `${t("book.title")} — ${t("brand.name")}`; }, [t]);
  useEffect(() => { setChat([{ role: "assistant", content: t("book.blake.welcome") }]); }, [t]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [chat]);

  async function reserve(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const rates: Record<string, number> = { escalade: 4.5, suburban: 4.2, denali: 4.8 };
      const est = 75 + rates[form.ride_type] * 15; // baseline placeholder distance
      const { error } = await supabase.from("bookings").insert({
        passenger_id: user.id,
        pickup: form.pickup, dropoff: form.dropoff,
        pickup_time: new Date(form.pickup_time).toISOString(),
        passengers: form.passengers, ride_type: form.ride_type,
        suggested_price: est,
      });
      if (error) throw error;
      toast.success(t("book.success"));
      setForm({ ...form, pickup: "", dropoff: "" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("book.failed"));
    } finally { setSaving(false); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    const next: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setDraft("");
    setSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast.error(t("book.chat.failed")); setSending(false); return; }
      const res = await fetch("/api/blake", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const message = await res.text().catch(() => "");
        toast.error(message || t("book.blake.unavailable"));
        setSending(false); return;
      }
      // All 5 concierges busy — show localized wait notice, no stream.
      if (res.headers.get("X-Concierge-Busy") === "1") {
        setChat([...next, { role: "assistant", content: t("book.blake.busy") }]);
        setSending(false); return;
      }
      const assigned = res.headers.get("X-Concierge-Agent");
      if (assigned && AGENT_ROLES[assigned]) setAgent(assigned);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      setChat([...next, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistant += decoder.decode(value, { stream: true });
        setChat([...next, { role: "assistant", content: assistant }]);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("book.chat.failed"));
    } finally { setSending(false); }
  }

  if (loading || !user) return <div className="min-h-screen bg-obsidian" />;

  return (
    <main className="min-h-screen bg-obsidian">
      {/* Top bar */}
      <header className="border-b border-border/40 backdrop-blur bg-background/50 sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <HarborLogo className="h-9 w-9" />
            <div className="hidden sm:block">
              <div className="font-display text-lg text-gradient-gold leading-none">HarborLine</div>
                <div className="text-[8px] tracking-[0.3em] text-muted-foreground mt-1 uppercase">{t("brand.services")}</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <LanguageMenu compact />
            <Link to="/history" className="rounded-md px-3 py-2 hover:bg-accent flex items-center gap-1.5">
              <History className="h-4 w-4" />{t("nav.history")}
            </Link>
            {role === "admin" && (
              <Link to="/admin" className="rounded-md px-3 py-2 hover:bg-accent flex items-center gap-1.5 text-gold">
                <ShieldCheck className="h-4 w-4" />{t("nav.admin")}
              </Link>
            )}
            <button onClick={signOut} className="rounded-md px-3 py-2 hover:bg-accent flex items-center gap-1.5">
              <LogOut className="h-4 w-4" />{t("nav.signout")}
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10 grid lg:grid-cols-5 gap-6">
        {/* Booking form */}
        <section className="lg:col-span-3 rounded-xl border border-border/60 bg-surface-elevated shadow-luxe p-8">
          <div className="text-xs tracking-[0.35em] text-gold uppercase">{t("book.kicker")}</div>
          <h1 className="mt-2 font-display text-3xl">{t("book.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("book.subtitle")}</p>

          <form onSubmit={reserve} className="mt-8 space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1.5">{t("book.pickup")}</label>
                <input required value={form.pickup} onChange={(e) => setForm({ ...form, pickup: e.target.value })} placeholder={t("book.pickup.example")} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none" />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1.5">{t("book.dropoff")}</label>
                <input required value={form.dropoff} onChange={(e) => setForm({ ...form, dropoff: e.target.value })} placeholder={t("book.dropoff.example")} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1.5">{t("book.time")}</label>
                <input required type="datetime-local" value={form.pickup_time} onChange={(e) => setForm({ ...form, pickup_time: e.target.value })} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-1.5">{t("book.passengers")}</label>
                <input required type="number" min={1} max={7} value={form.passengers} onChange={(e) => setForm({ ...form, passengers: Number(e.target.value) })} className="w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">{t("book.ride")}</label>
              <VehicleShowroom
                value={form.ride_type}
                onChange={(v) => setForm({ ...form, ride_type: v })}
              />
            </div>
            <button disabled={saving} className="w-full rounded-md bg-gold-gradient py-3.5 text-sm font-semibold text-primary-foreground shadow-gold disabled:opacity-60">

              {saving ? t("book.saving") : t("book.submit")}
            </button>
          </form>
        </section>

        {/* AI concierge team */}
        <aside className="lg:col-span-2 flex flex-col rounded-xl border border-border/60 bg-surface-elevated shadow-luxe overflow-hidden">
          <div className="border-b border-border/60 px-6 py-4 flex items-center gap-3 bg-background/50">
            <SiriOrb speaking size={36} />
            <div className="flex-1">
              <div className="font-display text-base">{agent} <span className="text-xs text-muted-foreground font-sans">· {AGENT_ROLES[agent] ?? "Concierge"}</span></div>
              <div className="text-[10px] tracking-widest text-muted-foreground uppercase">{t("book.blake.status")}</div>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[380px] max-h-[560px]">
            {chat.map((m, i) => (
              <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[85%] rounded-2xl px-4 py-2.5 text-sm " + (m.role === "user" ? "bg-gold-gradient text-primary-foreground" : "bg-accent border border-border/40")}>
                  {m.content || (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className="italic">{agent} {t("book.blake.typing")}</span>
                      <span className="flex gap-0.5">
                        <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border/60 p-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("book.blake.placeholder")}
              className="flex-1 rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none"
            />
            <button onClick={send} disabled={sending || !draft.trim()} className="rounded-md bg-gold-gradient px-4 disabled:opacity-50">
              <Send className="h-4 w-4 text-primary-foreground" />
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
