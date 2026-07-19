export function HarborLogo({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      aria-label="HarborLine"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bold custom H lettermark — slight forward lean, sharp angular terminals, flat gold */}
      <g transform="rotate(5 60 60)">
        <path
          fill="#D4AF37"
          d="M20,16 L52,16 L52,104 L20,104 Z M68,16 L100,16 L100,104 L68,104 Z M52,44 L68,44 L68,72 L52,72 Z"
        />
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
