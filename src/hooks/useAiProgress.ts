import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Progressive working-state for AI requests that can run longer than a few
 * seconds.
 *
 * Guest-safe by design: stage labels are generic, human phrases. No model
 * names, tiers, providers, reasoning, or API details are ever surfaced here.
 *
 * - progressive stages advance on elapsed time
 * - a single in-flight request at a time (duplicate submissions blocked)
 * - cancellation via AbortController, safe because reads are idempotent
 * - a "slow" flag after a threshold, and a hard timeout guard
 */

export type AiStage = 0 | 1 | 2 | 3;

/** Elapsed-time thresholds (ms) at which the next stage label appears. */
const STAGE_AT = [0, 6_000, 20_000, 60_000] as const;

export const DEFAULT_SLOW_AFTER_MS = 25_000;
export const DEFAULT_TIMEOUT_MS = 210_000;

export type AiProgressState = {
  running: boolean;
  stage: AiStage;
  elapsedMs: number;
  slow: boolean;
  canceled: boolean;
  timedOut: boolean;
};

export function useAiProgress(options?: { slowAfterMs?: number; timeoutMs?: number }) {
  const slowAfterMs = options?.slowAfterMs ?? DEFAULT_SLOW_AFTER_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const [state, setState] = useState<AiProgressState>({
    running: false,
    stage: 0,
    elapsedMs: 0,
    slow: false,
    canceled: false,
    timedOut: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const stopTicker = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTicker, [stopTicker]);

  const cancel = useCallback(() => {
    if (!runningRef.current) return;
    abortRef.current?.abort();
  }, []);

  /**
   * Runs `task` with progress tracking. Returns `null` when a request is
   * already in flight (duplicate submission) or when the run was canceled or
   * timed out. Any other failure is rethrown for the caller to present.
   */
  const run = useCallback(
    async <T,>(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
      if (runningRef.current) return null; // duplicate submission guard
      runningRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();

      setState({ running: true, stage: 0, elapsedMs: 0, slow: false, canceled: false, timedOut: false });

      stopTicker();
      timerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        let stage: AiStage = 0;
        for (let i = STAGE_AT.length - 1; i >= 0; i--) {
          if (elapsedMs >= STAGE_AT[i]!) {
            stage = i as AiStage;
            break;
          }
        }
        setState((s) => (s.running ? { ...s, stage, elapsedMs, slow: elapsedMs >= slowAfterMs } : s));
      }, 500);

      const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
      const timedOutRef = { value: false };
      const onAbort = () => {
        if (controller.signal.reason === "timeout") timedOutRef.value = true;
      };
      controller.signal.addEventListener("abort", onAbort);

      try {
        const result = await task(controller.signal);
        setState((s) => ({ ...s, running: false, elapsedMs: Date.now() - startedAt }));
        return result;
      } catch (e) {
        const aborted =
          controller.signal.aborted ||
          (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message)));
        if (aborted) {
          setState((s) => ({
            ...s,
            running: false,
            canceled: !timedOutRef.value,
            timedOut: timedOutRef.value,
            elapsedMs: Date.now() - startedAt,
          }));
          return null;
        }
        setState((s) => ({ ...s, running: false, elapsedMs: Date.now() - startedAt }));
        throw e;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        stopTicker();
        runningRef.current = false;
        abortRef.current = null;
      }
    },
    [slowAfterMs, timeoutMs, stopTicker],
  );

  return { ...state, run, cancel };
}
