import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createBookingCheckout } from "@/lib/payments.functions";
import { X } from "lucide-react";
import { useEffect } from "react";

export function BookingCheckoutModal({
  bookingId,
  onClose,
}: {
  bookingId: string;
  onClose: () => void;
}) {
  const fetchClientSecret = async (): Promise<string> => {
    const returnUrl = `${window.location.origin}/history?paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const res = await createBookingCheckout({
      data: { bookingId, returnUrl, environment: getStripeEnvironment() },
    });
    if ("error" in res) throw new Error(res.error);
    if (!res.clientSecret) throw new Error("No client secret");
    return res.clientSecret;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl h-dvh sm:h-auto sm:max-h-[90vh] sm:my-0 sm:rounded-2xl border-0 sm:border sm:border-gold/30 bg-surface-elevated shadow-luxe overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-3 border-b border-border/40">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-gold uppercase">HarborLine</div>
            <h2 className="mt-1 font-display text-xl sm:text-2xl">Complete payment</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div id="checkout" className="flex-1 overflow-y-auto p-2 sm:p-3">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
