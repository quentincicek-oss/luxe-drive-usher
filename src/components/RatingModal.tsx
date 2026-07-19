import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Star, X } from "lucide-react";
import { toast } from "sonner";

export function RatingModal({
  bookingId,
  passengerId,
  onClose,
  onSubmitted,
}: {
  bookingId: string;
  passengerId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!rating) return;
    setSaving(true);
    const { error } = await supabase.from("ride_reviews").upsert(
      { booking_id: bookingId, passenger_id: passengerId, rating, comment: comment.trim() || null },
      { onConflict: "booking_id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("review.thanks"));
    onSubmitted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-2xl border border-gold/30 bg-surface-elevated p-8 shadow-luxe"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
        <div className="text-[10px] tracking-[0.4em] text-gold uppercase text-center">HarborLine</div>
        <h2 className="mt-3 font-display text-2xl text-center">{t("review.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground text-center">{t("review.subtitle")}</p>

        <div className="mt-8 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
              className="transition-transform hover:scale-110"
            >
              <Star
                className={
                  "h-10 w-10 transition " +
                  ((hover || rating) >= n ? "fill-gold text-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.6)]" : "text-muted-foreground/40")
                }
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder={t("review.comment.placeholder")}
          className="mt-6 w-full rounded-md bg-input border border-border/60 px-3 py-2.5 text-sm focus:border-gold outline-none resize-none"
        />

        <button
          disabled={!rating || saving}
          onClick={submit}
          className="mt-6 w-full rounded-md bg-gold-gradient py-3 text-sm font-semibold text-primary-foreground shadow-gold disabled:opacity-50"
        >
          {saving ? t("review.saving") : t("review.submit")}
        </button>
      </div>
    </div>
  );
}
