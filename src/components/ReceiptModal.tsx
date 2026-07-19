import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { HarborLogo } from "@/components/HarborLogo";
import { requestReceiptOtp, verifyReceiptOtp } from "@/lib/receipts.functions";
import { toast } from "sonner";
import { ShieldCheck, X, Mail, Printer } from "lucide-react";

type BookingLite = {
  id: string;
  pickup: string;
  dropoff: string;
  pickup_time: string;
  ride_type: string;
  passengers: number;
  suggested_price: number | null;
  price: number | null;
  paid: boolean | null;
  paid_at: string | null;
  created_at: string;
};

export function ReceiptModal({
  bookingId,
  onClose,
}: {
  bookingId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"request" | "verify" | "receipt">("request");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<BookingLite | null>(null);
  const [profile, setProfile] = useState<{ name?: string | null; surname?: string | null; email?: string | null } | null>(null);

  function mask(email: string) {
    const [u, d] = email.split("@");
    if (!u || !d) return email;
    return `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}`;
  }

  async function requestCode() {
    setBusy(true);
    try {
      const res = await requestReceiptOtp({ data: { bookingId } });
      setMaskedEmail(mask(res.email));
      setDevCode(res.devCode ?? null);
      setStep("verify");
      toast.success(t("receipt.verify.sent"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const res = await verifyReceiptOtp({ data: { bookingId, code } });
      if (!res.ok) {
        toast.error(res.reason === "tooMany" ? t("receipt.verify.tooMany") : t("receipt.verify.invalid"));
        return;
      }
      setBooking(res.booking as BookingLite);
      setProfile(res.profile ?? null);
      setStep("receipt");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-2xl border border-gold/30 bg-surface-elevated shadow-luxe overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>

        {step === "request" && (
          <div className="p-10 text-center">
            <ShieldCheck className="h-10 w-10 text-gold mx-auto" />
            <h2 className="mt-4 font-display text-2xl">{t("receipt.verify.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("receipt.verify.body")}</p>
            <button
              disabled={busy}
              onClick={requestCode}
              className="mt-8 w-full rounded-md bg-gold-gradient py-3 text-sm font-semibold text-primary-foreground shadow-gold disabled:opacity-50"
            >
              <Mail className="inline h-4 w-4 mr-2" />
              {t("receipt.request")}
            </button>
          </div>
        )}

        {step === "verify" && (
          <div className="p-10 text-center">
            <Mail className="h-10 w-10 text-gold mx-auto" />
            <h2 className="mt-4 font-display text-2xl">{t("receipt.verify.title")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("receipt.verify.body")}<br />
              <span className="text-gold">{maskedEmail}</span>
            </p>
            {devCode && (
              <div className="mt-3 text-[10px] tracking-widest text-muted-foreground/70">
                (preview) code: <span className="text-gold">{devCode}</span>
              </div>
            )}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t("receipt.verify.placeholder")}
              inputMode="numeric"
              className="mt-6 w-full text-center tracking-[0.5em] text-2xl font-display rounded-md bg-input border border-border/60 px-3 py-3 focus:border-gold outline-none"
            />
            <button
              disabled={busy || code.length !== 6}
              onClick={verify}
              className="mt-6 w-full rounded-md bg-gold-gradient py-3 text-sm font-semibold text-primary-foreground shadow-gold disabled:opacity-50"
            >
              {t("receipt.verify.submit")}
            </button>
            <button onClick={requestCode} disabled={busy} className="mt-3 text-xs text-muted-foreground hover:text-gold">
              {t("receipt.verify.resend")}
            </button>
          </div>
        )}

        {step === "receipt" && booking && <ReceiptView booking={booking} profile={profile} />}
      </div>
    </div>
  );
}

function ReceiptView({
  booking,
  profile,
}: {
  booking: BookingLite;
  profile: { name?: string | null; surname?: string | null; email?: string | null } | null;
}) {
  const { t } = useI18n();
  const amount = booking.price ?? booking.suggested_price ?? 0;
  const number = `HL-${booking.id.slice(0, 8).toUpperCase()}`;
  const issued = new Date(booking.paid_at ?? booking.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
  });
  const rideLabel =
    booking.ride_type === "escalade" ? "Cadillac Escalade" :
    booking.ride_type === "suburban" ? "Chevrolet Suburban" : "GMC Denali";
  const fullName = [profile?.name, profile?.surname].filter(Boolean).join(" ") || profile?.email || "Guest";

  return (
    <div className="bg-gradient-to-b from-background to-obsidian">
      {/* Header band */}
      <div className="relative overflow-hidden border-b border-gold/20 px-8 pt-8 pb-6">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--gold)_0%,_transparent_60%)]" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HarborLogo className="h-10 w-10" />
            <div>
              <div className="font-display text-lg text-gradient-gold leading-none">HarborLine</div>
              <div className="text-[9px] tracking-[0.35em] text-muted-foreground mt-1 uppercase">Executive Services</div>
            </div>
          </div>
          <div className="text-right">
            <div className="inline-block rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-[10px] tracking-widest text-gold uppercase">
              {t("receipt.paid")}
            </div>
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="px-8 pt-6 pb-3 grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="uppercase tracking-widest text-muted-foreground">{t("receipt.number")}</div>
          <div className="mt-1 font-mono text-gold">{number}</div>
        </div>
        <div className="text-right">
          <div className="uppercase tracking-widest text-muted-foreground">{t("receipt.issued")}</div>
          <div className="mt-1">{issued}</div>
        </div>
        <div className="col-span-2">
          <div className="uppercase tracking-widest text-muted-foreground">{t("receipt.billTo")}</div>
          <div className="mt-1">{fullName}</div>
          {profile?.email && <div className="text-muted-foreground">{profile.email}</div>}
        </div>
      </div>

      {/* Line items */}
      <div className="mx-8 mt-4 rounded-lg border border-border/60 overflow-hidden">
        <div className="grid grid-cols-12 bg-background/50 px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <div className="col-span-7">{t("receipt.description")}</div>
          <div className="col-span-2 text-center">{t("receipt.qty")}</div>
          <div className="col-span-3 text-right">{t("receipt.amount")}</div>
        </div>
        <div className="grid grid-cols-12 px-4 py-4 text-sm">
          <div className="col-span-7">
            <div className="font-medium">{rideLabel}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {booking.pickup} → {booking.dropoff}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {new Date(booking.pickup_time).toLocaleString()} · {booking.passengers} pax
            </div>
          </div>
          <div className="col-span-2 text-center">1</div>
          <div className="col-span-3 text-right font-medium">${amount.toFixed(2)}</div>
        </div>
      </div>

      {/* Totals */}
      <div className="px-8 py-6 space-y-2 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{t("receipt.subtotal")}</span>
          <span>${amount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-baseline border-t border-gold/20 pt-3 mt-3">
          <span className="uppercase tracking-widest text-xs text-muted-foreground">{t("receipt.total")}</span>
          <span className="font-display text-3xl text-gradient-gold">${amount.toFixed(2)} <span className="text-xs align-top text-muted-foreground">USD</span></span>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 px-8 py-5 flex items-center justify-between bg-background/30">
        <div className="text-[10px] tracking-widest text-muted-foreground uppercase">{t("receipt.thankyou")}</div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full border border-gold/50 px-4 py-1.5 text-xs text-gold hover:bg-gold/10"
        >
          <Printer className="h-3.5 w-3.5" /> {t("receipt.download")}
        </button>
      </div>
    </div>
  );
}
