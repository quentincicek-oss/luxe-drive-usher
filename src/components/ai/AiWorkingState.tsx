import { SiriOrb } from "@/components/SiriOrb";
import { cn } from "@/lib/utils";
import type { AiStage } from "@/hooks/useAiProgress";

/**
 * Non-blocking working state for AI requests. Guest-safe: shows generic
 * progress language only — never model names, tiers, reasoning or providers.
 */

export const STAGE_KEYS = [
  "ai.working.stage1",
  "ai.working.stage2",
  "ai.working.stage3",
  "ai.working.stage4",
] as const;

const STAGE_FALLBACK = [
  "Analyzing request",
  "Checking operational constraints",
  "Running deeper analysis",
  "Finalizing recommendation",
] as const;

export function stageLabel(stage: AiStage, t?: (k: string) => string) {
  const key = STAGE_KEYS[stage];
  const translated = t?.(key);
  return !translated || translated === key ? STAGE_FALLBACK[stage] : translated;
}

export function AiWorkingState({
  stage,
  elapsedMs,
  slow,
  onCancel,
  cancelLabel = "Cancel",
  slowNote = "Still working — detailed requests can take a couple of minutes.",
  t,
  className,
}: {
  stage: AiStage;
  elapsedMs: number;
  slow?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
  slowNote?: string;
  t?: (k: string) => string;
  className?: string;
}) {
  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-gold/25 bg-background/60 px-3.5 py-3",
        className,
      )}
      data-testid="ai-working-state"
    >
      <SiriOrb speaking size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm text-gradient-gold font-medium" data-testid="ai-working-stage">
            {stageLabel(stage, t)}
          </span>
          <span className="flex gap-0.5" aria-hidden>
            <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="h-1 w-1 rounded-full bg-gold animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground tabular-nums">
            {seconds}s
          </span>
        </div>

        {/* Indeterminate luxe progress rail */}
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-border/60">
          <div className="ai-progress-rail h-full w-1/3 bg-gold-gradient" />
        </div>

        {slow && <p className="mt-2 text-xs text-muted-foreground">{slowNote}</p>}
      </div>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:border-gold/60 hover:text-foreground transition-colors"
          data-testid="ai-cancel"
        >
          {cancelLabel}
        </button>
      )}
    </div>
  );
}

export default AiWorkingState;
