export function HarborLogo({ className = "h-14 w-14", withGlow = true }: { className?: string; withGlow?: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-label="HarborLine">
      <defs>
        <linearGradient id="hl-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F0D97B" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9C7A24" />
        </linearGradient>
        {withGlow && (
          <filter id="hl-glow"><feGaussianBlur stdDeviation="1.2" /></filter>
        )}
      </defs>
      {/* Arch */}
      <path d="M20 78 Q60 8 100 78" stroke="url(#hl-gold)" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* H */}
      <g fill="url(#hl-gold)">
        <rect x="38" y="42" width="5" height="42" rx="1.2" />
        <rect x="77" y="42" width="5" height="42" rx="1.2" />
        <rect x="38" y="60" width="44" height="5" rx="1.2" />
      </g>
      {/* Wave */}
      <path d="M18 96 Q35 88 52 96 T86 96 T102 92" stroke="url(#hl-gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M22 104 Q39 97 56 104 T90 104" stroke="url(#hl-gold)" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={"flex flex-col items-center " + className}>
      <div className="font-display text-4xl md:text-5xl font-semibold tracking-tight text-gradient-gold">HarborLine</div>
      <div className="mt-1 text-[10px] md:text-xs tracking-[0.4em] text-muted-foreground">EXECUTIVE SERVICES</div>
    </div>
  );
}
