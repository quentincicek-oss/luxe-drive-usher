import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createBookingCheckout } from "@/lib/payments.functions";
import { X } from "lucide-react";

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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl my-8 rounded-2xl border border-gold/30 bg-surface-elevated shadow-luxe overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
        <div className="px-6 pt-6 pb-2">
          <div className="text-[10px] tracking-[0.4em] text-gold uppercase">HarborLine</div>
          <h2 className="mt-2 font-display text-2xl">Complete payment</h2>
        </div>
        <div id="checkout" className="p-2">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
