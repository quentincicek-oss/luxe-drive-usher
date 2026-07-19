import { KeyRound, Nfc, QrCode } from "lucide-react";
import { VERIFICATION_REQUIRED } from "@/lib/driver.constants";

export function VerificationSlot({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-5 space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Passenger verification</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Verify your passenger's identity before starting the trip.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: KeyRound, label: "PIN" },
          { icon: Nfc,      label: "NFC" },
          { icon: QrCode,   label: "QR" },
        ].map(({ icon: I, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 bg-white/[0.02] p-4 opacity-60"
          >
            <I className="h-5 w-5 text-muted-foreground" />
            <div className="text-xs">{label}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Soon</div>
          </div>
        ))}
      </div>
      <button
        onClick={onSkip}
        disabled={VERIFICATION_REQUIRED}
        className="w-full min-h-[52px] rounded-full border border-border/60 bg-white/5 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
      >
        {VERIFICATION_REQUIRED ? "Verification required" : "Confirm passenger identified"}
      </button>
    </div>
  );
}
