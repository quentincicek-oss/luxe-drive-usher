import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { SiriOrb } from "@/components/SiriOrb";
import { AiWorkingState } from "@/components/ai/AiWorkingState";
import { useAiProgress } from "@/hooks/useAiProgress";
import { Send, X } from "lucide-react";
import { toast } from "sonner";


type ChatMsg = { role: "user" | "assistant"; content: string };

const AGENT_ROLES: Record<string, string> = {
  Blake: "Head Concierge",
  Ava: "Reservations Lead",
  Marcus: "Airport Specialist",
  Sophia: "Events & VIP Liaison",
  Julian: "Route Advisor",
};

export function ConciergeWidget() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("Blake");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const progress = useAiProgress({ slowAfterMs: 12_000, timeoutMs: 120_000 });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && chat.length === 0) {
      setChat([{ role: "assistant", content: t("book.blake.welcome") }]);
    }
  }, [open, chat.length, t]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, open]);

  if (loading || !user) return null;
  if (pathname === "/" || pathname.startsWith("/auth") || pathname.startsWith("/admin")) return null;


  async function send() {
    const text = draft.trim();
    // Duplicate-submission guard: one concierge request at a time.
    if (!text || sending || progress.running) return;
    const next: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(next);
    setDraft("");
    setSending(true);
    setStreaming(false);
    try {
      const outcome = await progress.run(async (signal) => {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error(t("book.chat.failed"));
        const res = await fetch("/api/blake", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages: next }),
          signal,
        });
        if (!res.ok || !res.body) {
          const message = await res.text().catch(() => "");
          throw new Error(message || t("book.blake.unavailable"));
        }
        if (res.headers.get("X-Concierge-Busy") === "1") {
          setChat([...next, { role: "assistant", content: t("book.blake.busy") }]);
          return "busy" as const;
        }
        const assigned = res.headers.get("X-Concierge-Agent");
        if (assigned && AGENT_ROLES[assigned]) setAgent(assigned);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistant = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistant += decoder.decode(value, { stream: true });
          if (!assistant.trim()) continue;
          setStreaming(true);
          setChat([...next, { role: "assistant", content: assistant }]);
        }
        return "ok" as const;
      });
      // `null` = canceled, timed out, or a duplicate submission was blocked.
      if (outcome === null) {
        const note = progress.timedOut ? t("ai.working.timeout") : t("ai.working.canceled");
        toast.message(note);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("book.chat.failed"));
    } finally {
      setSending(false);
      setStreaming(false);
    }
  }


  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 sm:bottom-6 right-4 sm:right-6 z-40 group flex items-center gap-3 rounded-full border border-gold/40 bg-obsidian/90 backdrop-blur pl-3 pr-4 sm:pr-5 py-2.5 shadow-luxe hover:shadow-gold transition-all"
          aria-label="Open concierge"
        >
          <SiriOrb speaking={false} size={38} />
          <span className="hidden sm:flex flex-col items-start leading-tight">
            <span className="font-display text-sm text-gradient-gold">
              {t("landing.hero.title1")} {t("landing.hero.title2")}
            </span>
            <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground">
              {t("book.blake.status")}
            </span>
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[min(400px,calc(100vw-2rem))] h-[min(600px,calc(100vh-4rem))] flex flex-col rounded-2xl border border-gold/30 bg-obsidian shadow-luxe overflow-hidden">
          <div className="border-b border-border/60 px-4 py-3 flex items-center gap-3 bg-background/60">
            <SiriOrb speaking={sending} size={36} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-base truncate">
                {agent} <span className="text-xs text-muted-foreground font-sans">· {AGENT_ROLES[agent] ?? "Concierge"}</span>
              </div>
              <div className="text-[10px] tracking-widest text-muted-foreground uppercase">{t("book.blake.status")}</div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-accent" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {chat.map((m, i) => (
              <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm " + (m.role === "user" ? "bg-gold-gradient text-primary-foreground" : "bg-accent border border-border/40")}>
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
          <div className="border-t border-border/60 p-2.5 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("book.blake.placeholder")}
              className="flex-1 rounded-md bg-input border border-border/60 px-3 py-2 text-sm focus:border-gold outline-none"
            />
            <button onClick={send} disabled={sending || !draft.trim()} className="rounded-md bg-gold-gradient px-3.5 disabled:opacity-50">
              <Send className="h-4 w-4 text-primary-foreground" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
