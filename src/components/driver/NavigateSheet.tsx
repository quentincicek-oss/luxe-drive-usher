import { Navigation, MapPin } from "lucide-react";

export function NavigateButton({ destination }: { destination: string }) {
  const enc = encodeURIComponent(destination);
  const isApple =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod|Mac/.test(navigator.platform || navigator.userAgent);
  const url = isApple
    ? `maps://?daddr=${enc}`
    : `https://www.google.com/maps/dir/?api=1&destination=${enc}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-gold-gradient px-5 py-3 text-sm font-medium text-primary-foreground shadow-gold"
    >
      <Navigation className="h-4 w-4" />
      Navigate — {isApple ? "Apple Maps" : "Google Maps"}
    </a>
  );
}

export function DestinationLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <MapPin className="mt-0.5 h-4 w-4 text-gold shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-sm">{value}</div>
      </div>
    </div>
  );
}
