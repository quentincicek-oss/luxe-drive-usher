import { useEffect, useState } from "react";

/**
 * Siri-style animated orb — champagne gold waves that ripple as if speaking.
 * Pass `speaking` to intensify motion while the concierge is "typing".
 */
export function SiriOrb({ speaking = true, size = 36 }: { speaking?: boolean; size?: number }) {
  // subtle randomised phase so multiple orbs never sync
  const [phase] = useState(() => Math.random() * 6);

  return (
    <div
      className="siri-orb relative overflow-hidden rounded-full"
      data-speaking={speaking ? "true" : "false"}
      style={{ width: size, height: size, ["--phase" as any]: `${phase}s` }}
      aria-hidden
    >
      <span className="siri-core" />
      <span className="siri-wave siri-wave-1" />
      <span className="siri-wave siri-wave-2" />
      <span className="siri-wave siri-wave-3" />
      <span className="siri-highlight" />
    </div>
  );
}

export default SiriOrb;
