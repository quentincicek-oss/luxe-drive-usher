import { useState } from "react";
import { KeyRound, Nfc, QrCode, Check, Lock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { verifyPin, recordVerification } from "@/lib/trust.functions";
import { toast } from "sonner";

type Settings = { pin_enabled: boolean; qr_enabled: boolean; nfc_enabled: boolean };

export function VerificationSlot({
  bookingId,
  settings,
  verified,
  onVerified,
}: {
  bookingId: string;
  settings: Settings;
  verified: boolean;
  onVerified: () => void;
}) {
  const [method, setMethod] = useState<"pin" | "qr" | "nfc">(
    settings.pin_enabled ? "pin" : settings.qr_enabled ? "qr" : "nfc"
  );
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);

  const submitPinFn = useServerFn(verifyPin);
  const recordFn = useServerFn(recordVerification);

  if (verified) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <Check className="h-5 w-5 text-emerald-400" />
        <div>
          <div className="text-sm font-medium">Passenger verified</div>
          <div className="text-xs text-muted-foreground">You may start the trip.</div>
        </div>
      </div>
    );
  }

  const methods: Array<{ key: "pin" | "qr" | "nfc"; label: string; icon: any; enabled: boolean }> = [
    { key: "pin", label: "PIN", icon: KeyRound, enabled: settings.pin_enabled },
    { key: "qr",  label: "QR",  icon: QrCode,   enabled: settings.qr_enabled },
    { key: "nfc", label: "NFC", icon: Nfc,      enabled: settings.nfc_enabled },
  ];

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (method === "pin") {
        if (!/^\d{4}$/.test(pin)) { toast.error("Enter the 4-digit PIN"); return; }
        const res = await submitPinFn({ data: { bookingId, pin } });
        if (res.ok) { toast.success("Verified"); onVerified(); }
        else if (res.reason === "locked") { setLocked(true); toast.error("Locked — try again later"); }
        else { toast.error(`Incorrect PIN (${res.attempts}/5)`); setPin(""); }
      } else {
        await recordFn({ data: { bookingId, method } });
        toast.success("Verified");
        onVerified();
      }
    } catch (e: any) {
      toast.error(e.message ?? "Verification failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-5 space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Passenger verification</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Verify your passenger's identity before starting the trip.
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {methods.map(({ key, label, icon: I, enabled }) => (
          <button
            key={key}
            onClick={() => enabled && setMethod(key)}
            disabled={!enabled}
            className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-xs transition ${
              method === key && enabled
                ? "border-gold bg-gold/10 text-foreground"
                : "border-border/60 bg-white/[0.02] text-muted-foreground"
            } ${!enabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/5"}`}
          >
            <I className="h-5 w-5" />
            {label}
            {!enabled && <span className="text-[9px] uppercase tracking-widest">Off</span>}
          </button>
        ))}
      </div>

      {method === "pin" && (
        <div className="space-y-2">
          <input
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="• • • •"
            className="w-full rounded-xl border border-border/60 bg-white/[0.02] px-4 py-4 text-center font-mono text-2xl tracking-[0.6em]"
            disabled={locked}
          />
          <div className="text-[11px] text-muted-foreground text-center">
            Ask the passenger for their 4-digit PIN.
          </div>
        </div>
      )}
      {method === "qr" && (
        <div className="text-xs text-muted-foreground text-center py-4">
          Scan the passenger's QR code, then confirm.
        </div>
      )}
      {method === "nfc" && (
        <div className="text-xs text-muted-foreground text-center py-4">
          Hold the passenger's NFC card near the device, then confirm.
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || locked || (method === "pin" && pin.length !== 4)}
        className="w-full min-h-[52px] rounded-full bg-gold-gradient text-sm font-medium text-primary-foreground shadow-gold disabled:opacity-50"
      >
        {locked ? (<><Lock className="inline h-4 w-4 mr-2" /> Locked</>) : method === "pin" ? "Verify PIN" : "Confirm verified"}
      </button>
    </div>
  );
}
