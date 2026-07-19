import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/15 py-1.5 text-[12px] font-medium text-amber-200 backdrop-blur">
      <WifiOff className="h-3.5 w-3.5" />
      You're offline. Changes will sync when you're back.
    </div>
  );
}
