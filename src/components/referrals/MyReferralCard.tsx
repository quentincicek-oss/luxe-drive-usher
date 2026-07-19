import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";
import { getOrCreateMyReferralCode } from "@/lib/referrals.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

interface Reward { id: string; status: string; amount_percent: number | null; amount_flat: number | null; expires_at: string | null; issued_at: string; }

export function MyReferralCard() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const ensureCode = useServerFn(getOrCreateMyReferralCode);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const c = await ensureCode({});
        setCode((c as any).code);
        const url = `${window.location.origin}/r/${(c as any).code}?src=link`;
        setQr(await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#D4AF37", light: "#00000000" } }));
      } catch (e: any) { toast.error(e?.message ?? "Failed to load referral code"); }

      const [rw, ct] = await Promise.all([
        (supabase as any).from("referral_rewards").select("*").eq("recipient_user_id", user.id).order("issued_at", { ascending: false }),
        (supabase as any).from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id),
      ]);
      setRewards((rw.data ?? []) as Reward[]);
      setReferralCount(ct.count ?? 0);
      setLoading(false);
    })();
  }, [user, ensureCode]);

  if (!user) return null;

  const shareUrl = code ? `${window.location.origin}/r/${code}?src=link` : "";

  async function copy() { await navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); }
  async function share() {
    if ((navigator as any).share) {
      try { await (navigator as any).share({ title: "HarborLine", text: "Join me on HarborLine", url: shareUrl }); } catch { /* cancelled */ }
    } else copy();
  }

  const pending = rewards.filter(r => r.status === "pending").length;
  const redeemed = rewards.filter(r => r.status === "redeemed").length;

  return (
    <div className="rounded-2xl border border-border/60 bg-surface/60 p-6 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Invite & earn</div>
          <div className="font-display text-2xl text-gradient-gold mt-1">Your invitation</div>
          <div className="text-sm text-muted-foreground mt-1">Share HarborLine. Both parties are rewarded on the first ride.</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Code</div>
          <div className="font-mono text-xl text-gold">{code ?? "…"}</div>
        </div>
      </div>

      <div className="mt-6 grid sm:grid-cols-[auto,1fr] gap-6 items-center">
        {qr ? (
          <img src={qr} alt="Referral QR" className="w-40 h-40 rounded-xl border border-border/60 bg-black" />
        ) : (
          <div className="w-40 h-40 rounded-xl border border-border/60 bg-black animate-pulse" />
        )}
        <div className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-input px-3 py-2 text-xs font-mono break-all">{shareUrl || "…"}</div>
          <div className="flex gap-2">
            <button onClick={share} className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-primary-foreground shadow-gold">Share</button>
            <button onClick={copy} className="rounded-full border border-border/60 px-5 py-2 text-sm hover:bg-accent/40">Copy link</button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center pt-2">
            <Stat label="Invited" value={referralCount} />
            <Stat label="Pending rewards" value={pending} />
            <Stat label="Redeemed" value={redeemed} />
          </div>
        </div>
      </div>

      {!loading && rewards.length > 0 && (
        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Your rewards</div>
          <div className="space-y-1.5">
            {rewards.slice(0,5).map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs rounded-lg border border-border/40 bg-black/30 px-3 py-2">
                <span className="text-gold">{r.amount_percent ? `${r.amount_percent}%` : ""}{r.amount_flat ? ` $${r.amount_flat}` : ""}</span>
                <span className="text-muted-foreground">{r.expires_at ? `Expires ${new Date(r.expires_at).toLocaleDateString()}` : "No expiry"}</span>
                <span className="uppercase tracking-widest">{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/40 bg-black/30 py-2">
      <div className="font-display text-lg text-gold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
