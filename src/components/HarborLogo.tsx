export function HarborLogo({ className = "h-16 w-16", withGlow = true }: { className?: string; withGlow?: boolean }) {
  return (
    <svg viewBox="0 0 140 160" className={className} aria-label="HarborLine" fill="none">
      <defs>
        <linearGradient id="hl-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4E39A" />
          <stop offset="45%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#8A6A1F" />
        </linearGradient>
        <radialGradient id="hl-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#F4E39A" />
          <stop offset="100%" stopColor="#D4AF37" />
        </radialGradient>
        {withGlow && (
          <filter id="hl-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        )}
      </defs>

      {/* — Compass / wind rose (Montauk lighthouse mariners' rose) — */}
      <g transform="translate(70 44)" stroke="url(#hl-gold)" strokeLinecap="round" strokeLinejoin="round">
        {/* outer ring */}
        <circle r="34" strokeWidth="0.8" opacity="0.55" />
        <circle r="30" strokeWidth="0.4" opacity="0.35" />
        {/* tick marks around ring */}
        <g strokeWidth="0.6" opacity="0.7">
          {Array.from({ length: 32 }).map((_, i) => {
            const a = (i * Math.PI) / 16;
            const r1 = 30, r2 = i % 4 === 0 ? 25 : 27.5;
            return (
              <line
                key={i}
                x1={Math.sin(a) * r1}
                y1={-Math.cos(a) * r1}
                x2={Math.sin(a) * r2}
                y2={-Math.cos(a) * r2}
              />
            );
          })}
        </g>

        {/* diagonal (intercardinal) slim points */}
        <g fill="url(#hl-gold)" stroke="none" opacity="0.85">
          <path d="M0 0 L4 -4 L0 -22 L-4 -4 Z" transform="rotate(45)" />
          <path d="M0 0 L4 -4 L0 -22 L-4 -4 Z" transform="rotate(135)" />
          <path d="M0 0 L4 -4 L0 -22 L-4 -4 Z" transform="rotate(225)" />
          <path d="M0 0 L4 -4 L0 -22 L-4 -4 Z" transform="rotate(315)" />
        </g>

        {/* cardinal star — long slender points */}
        <g fill="url(#hl-gold)" stroke="none">
          {/* N */}
          <path d="M0 0 L3.2 -5 L0 -30 L-3.2 -5 Z" />
          {/* E */}
          <path d="M0 0 L5 -3.2 L30 0 L5 3.2 Z" />
          {/* S */}
          <path d="M0 0 L3.2 5 L0 30 L-3.2 5 Z" />
          {/* W */}
          <path d="M0 0 L-5 -3.2 L-30 0 L-5 3.2 Z" />
        </g>

        {/* center */}
        <circle r="2.2" fill="url(#hl-core)" stroke="none" />
        <circle r="4" strokeWidth="0.5" opacity="0.6" />

        {/* tiny N marker */}
        <text
          x="0"
          y="-36"
          textAnchor="middle"
          fontFamily="'Playfair Display', serif"
          fontSize="7"
          fontStyle="italic"
          fill="url(#hl-gold)"
          stroke="none"
          letterSpacing="0.5"
        >N</text>
      </g>

      {/* — Elegant thin H — */}
      <g
        stroke="url(#hl-gold)"
        strokeLinecap="round"
        fill="none"
        filter={withGlow ? "url(#hl-glow)" : undefined}
      >
        {/* Verticals — slim, tall, refined */}
        <line x1="42" y1="88" x2="42" y2="150" strokeWidth="1.4" />
        <line x1="98" y1="88" x2="98" y2="150" strokeWidth="1.4" />
        {/* Serif caps — top */}
        <line x1="36" y1="88" x2="48" y2="88" strokeWidth="1" opacity="0.85" />
        <line x1="92" y1="88" x2="104" y2="88" strokeWidth="1" opacity="0.85" />
        {/* Serif caps — bottom */}
        <line x1="36" y1="150" x2="48" y2="150" strokeWidth="1" opacity="0.85" />
        <line x1="92" y1="150" x2="104" y2="150" strokeWidth="1" opacity="0.85" />
        {/* Hairline crossbar with a subtle diamond accent */}
        <line x1="42" y1="119" x2="98" y2="119" strokeWidth="0.9" />
      </g>
      <g fill="url(#hl-core)" stroke="none">
        <path d="M70 115 L74 119 L70 123 L66 119 Z" opacity="0.95" />
      </g>
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
