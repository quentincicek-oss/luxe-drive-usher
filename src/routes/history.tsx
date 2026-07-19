import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { RatingModal } from "@/components/RatingModal";
import { ReceiptModal } from "@/components/ReceiptModal";
import { BookingCheckoutModal } from "@/components/BookingCheckoutModal";
import { Star, Receipt, CreditCard, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { MyReferralCard } from "@/components/referrals/MyReferralCard";

interface Booking {
  id: string; pickup: string; dropoff: string; pickup_time: string;
  ride_type: string; status: string; suggested_price: number | null; price: number | null;
  passengers: number; created_at: string; paid: boolean | null;
}

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Trip History — HarborLine Executive Services" },
      { name: "description", content: "Review your past HarborLine reservations." },
    ],
  }),
  component: History,
});

function History() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [rows, setRows] = useState<Booking[]>([]);
  const [busy, setBusy] = useState(true);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);

  useEffect(() => { document.title = `${t("history.title")} — ${t("brand.name")}`; }, [t]);
  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  async function refresh() {
    const [{ data: bs }, { data: rvs }] = await Promise.all([
      supabase.from("bookings").select("*").order("pickup_time", { ascending: false }).limit(100),
      supabase.from("ride_reviews").select("booking_id"),
    ]);
    setRows((bs ?? []) as Booking[]);
    setReviewed(new Set(((rvs ?? []) as { booking_id: string }[]).map((r) => r.booking_id)));
    setBusy(false);
  }

  useEffect(() => { if (user) refresh(); }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") !== "1") return;
    toast.success("Payment received — updating your booking…");
    let n = 0;
    const timer = setInterval(async () => {
      n += 1;
      await refresh();
      if (n >= 6) clearInterval(timer);
    }, 1500);
    window.history.replaceState({}, "", "/history");
    return () => clearInterval(timer);
  }, []);

  if (loading || !user) return <div className="min-h-dvh bg-obsidian" />;

  return (
    <main className="min-h-dvh bg-obsidian">
      <AppHeader />
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] tracking-[0.35em] text-gold uppercase">{t("history.kicker")}</div>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">{t("history.title")}</h1>
          </div>
          <Link to="/book" className="btn-primary-luxe">{t("history.new")}</Link>
        </div>

        {busy ? (
          <div className="space-y-3">
            {[0,1,2].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="card-luxe p-12 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-gold" />
            <p className="mt-4 font-display text-xl">{t("history.empty")}</p>
            <Link to="/book" className="btn-primary-luxe mt-6 inline-flex">{t("history.book")}</Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((b) => {
              const done = b.status === "completed";
              const alreadyReviewed = reviewed.has(b.id);
              return (
                <li key={b.id} className="card-luxe p-5 grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center hover:border-gold/40 transition-colors">
                  <div className="min-w-0">
                    <div className="text-[10px] tracking-[0.28em] text-muted-foreground uppercase">
                      {new Date(b.pickup_time).toLocaleString()}
                    </div>
                    <div className="mt-1 font-medium truncate">
                      {b.pickup} <span className="text-gold mx-2">→</span> {b.dropoff}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground capitalize">
                      {b.ride_type} · {b.passengers} {t("history.pax")} · {t(`status.${b.status}`)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="font-display text-lg text-gradient-gold">
                        ${(b.price ?? b.suggested_price ?? 0).toFixed(0)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 items-stretch">
                      {!b.paid ? (
                        <button onClick={() => setPayFor(b.id)} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gold-gradient px-3.5 h-9 text-xs font-medium text-primary-foreground shadow-gold">
                          <CreditCard className="h-3.5 w-3.5" /> Pay
                        </button>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-gold/40 bg-gold/5 px-3.5 h-8 text-xs text-gold">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                        </span>
                      )}
                      {done && !alreadyReviewed && (
                        <button onClick={() => setRateFor(b.id)} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-gold/50 px-3.5 h-9 text-xs text-gold hover:bg-gold/10">
                          <Star className="h-3.5 w-3.5" /> {t("review.submit")}
                        </button>
                      )}
                      {b.paid && (
                        <button onClick={() => setReceiptFor(b.id)} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border/60 px-3.5 h-9 text-xs hover:border-gold hover:text-gold">
                          <Receipt className="h-3.5 w-3.5" /> {t("receipt.request")}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-10">
          <MyReferralCard />
        </div>
      </section>
      {rateFor && user && (
        <RatingModal
          bookingId={rateFor}
          passengerId={user.id}
          onClose={() => setRateFor(null)}
          onSubmitted={() => { setReviewed((s) => new Set([...s, rateFor])); setRateFor(null); }}
        />
      )}
      {receiptFor && <ReceiptModal bookingId={receiptFor} onClose={() => setReceiptFor(null)} />}
      {payFor && <BookingCheckoutModal bookingId={payFor} onClose={() => setPayFor(null)} />}
    </main>
  );
}
