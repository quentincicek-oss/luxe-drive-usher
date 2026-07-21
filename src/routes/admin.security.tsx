import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Copy, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { generateRecoveryCodes, recoveryStatus } from "@/lib/recovery.functions";

export const Route = createFileRoute("/admin/security")({
  head: () => ({
    meta: [
      { title: "HarborLine Admin — Security" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SecurityPage,
});

/**
 * Admin security surface. The `/admin` layout already enforces admin role +
 * aal2 for anything under it, so this route is only reachable to a
 * fully-authenticated admin. Server-side, admin_generate_recovery_codes also
 * requires aal2 as a second line of defence.
 */
function SecurityPage() {
  const { t } = useI18n();
  const generate = useServerFn(generateRecoveryCodes);
  const status = useServerFn(recoveryStatus);

  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<{ totalCodes: number; unusedCodes: number } | null>(null);

  async function refresh() {
    try {
      const s = await status();
      setStats({ totalCodes: s.totalCodes ?? 0, unusedCodes: s.unusedCodes ?? 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load status");
    }
  }
  useEffect(() => { refresh(); }, []);

  async function onGenerate() {
    if (stats && stats.unusedCodes > 0) {
      const ok = window.confirm("Regenerating will invalidate all existing unused codes. Continue?");
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { codes: generated } = await generate({});
      setCodes(generated);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally { setBusy(false); }
  }

  async function copyAll() {
    if (!codes) return;
    await navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-dvh bg-obsidian px-4 py-10 text-foreground">
      <div className="mx-auto max-w-2xl">
        <nav className="mb-6 text-xs text-muted-foreground">
          <Link to="/admin" className="text-gold hover:underline">← Admin console</Link>
        </nav>
        <h1 className="mb-2 font-display text-3xl text-gradient-gold">Security</h1>

        <section className="mt-8 rounded-2xl border border-gold/30 bg-surface/40 p-6 shadow-luxe">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-gold" />
            <h2 className="font-display text-lg">{t("admin.recovery.title")}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.recovery.subtitle")}</p>

          {stats && (
            <div className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">
              {t("admin.recovery.status").replace("{unused}", String(stats.unusedCodes)).replace("{total}", String(stats.totalCodes))}
            </div>
          )}

          {codes ? (
            <div className="mt-5 rounded-lg border border-gold/40 bg-background p-4">
              <div className="text-[11px] uppercase tracking-widest text-gold">{t("admin.recovery.warning")}</div>
              <ul className="mt-3 grid grid-cols-1 gap-1 font-mono text-sm sm:grid-cols-2">
                {codes.map((c) => <li key={c} className="rounded bg-obsidian/60 px-2 py-1 tracking-widest">{c}</li>)}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={copyAll} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:border-gold">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {t("admin.recovery.copy")}
                </button>
                <button onClick={() => setCodes(null)} className="rounded-md border border-gold/40 px-3 py-1.5 text-xs text-gold hover:bg-gold/10">
                  {t("admin.recovery.done")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={onGenerate}
              disabled={busy}
              className="mt-5 btn-primary-luxe justify-center"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              <span>{stats && stats.unusedCodes > 0 ? t("admin.recovery.regenerate") : t("admin.recovery.generate")}</span>
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
