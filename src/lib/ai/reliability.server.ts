/**
 * Reliability assessment for AI-assisted RIE results.
 *
 * A model's self-reported confidence is ONE weak signal among several. This
 * module combines it with deterministic evidence and never presents the
 * outcome as proven certainty — the wording is deliberately "assessment".
 */

export interface ReliabilitySignals {
  /** Share of required facts actually supplied by the application (0–1). */
  inputCompleteness: number;
  /** Deterministic application rules all evaluated cleanly. */
  deterministicRulesPassed: boolean;
  /** Response matched the required schema on the first valid parse. */
  schemaValid: boolean;
  /** Deterministic rules contradicted the AI recommendation. */
  contradictions: number;
  /** Facts the analysis said it was missing. */
  missingFacts: number;
  /** Model's own self-reported confidence (0–1) — untrusted on its own. */
  modelConfidence: number;
  /** A fallback model handled the request. */
  fallbackUsed: boolean;
  /** The request was escalated to the deep tier. */
  escalated: boolean;
}

export type ReliabilityBand = "high" | "moderate" | "low" | "unusable";

export interface ReliabilityAssessment {
  /** Composite score, 0–1. An estimate of evidence quality, NOT a probability of correctness. */
  score: number;
  band: ReliabilityBand;
  /** True when a human must sign off before the recommendation is acted on. */
  humanReviewRequired: boolean;
  factors: Array<{ factor: string; weight: number; value: number; note: string }>;
  disclaimer: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function assessReliability(s: ReliabilitySignals): ReliabilityAssessment {
  const factors = [
    {
      factor: "input_completeness",
      weight: 0.25,
      value: clamp01(s.inputCompleteness),
      note: "Share of required deterministic facts supplied by the application.",
    },
    {
      factor: "deterministic_rules",
      weight: 0.25,
      value: s.deterministicRulesPassed ? 1 : 0,
      note: "Application rule engine evaluated without violations.",
    },
    {
      factor: "schema_validation",
      weight: 0.15,
      value: s.schemaValid ? 1 : 0,
      note: "Model output matched the required structured contract.",
    },
    {
      factor: "contradictions",
      weight: 0.15,
      value: clamp01(1 - s.contradictions * 0.5),
      note: "AI recommendation vs deterministic rules.",
    },
    {
      factor: "missing_facts",
      weight: 0.1,
      value: clamp01(1 - s.missingFacts * 0.25),
      note: "Facts the analysis itself flagged as absent.",
    },
    {
      factor: "model_self_confidence",
      weight: 0.1,
      value: clamp01(s.modelConfidence),
      note: "Self-reported by the model; treated as a weak signal only.",
    },
  ];

  let score = factors.reduce((n, f) => n + f.weight * f.value, 0);
  // Routing incidents lower confidence in the evidence chain, never raise it.
  if (s.fallbackUsed) score -= 0.05;
  if (s.escalated) score -= 0.03;
  score = clamp01(score);

  // Hard floors: some failures cannot be averaged away.
  if (!s.schemaValid) score = Math.min(score, 0.2);
  if (s.contradictions > 0) score = Math.min(score, 0.45);
  if (!s.deterministicRulesPassed) score = Math.min(score, 0.5);
  // A model that reports very low confidence in its own answer cannot yield a
  // high reliability band, however complete the deterministic inputs were.
  if (s.modelConfidence < 0.35) score = Math.min(score, 0.55);
  else if (s.modelConfidence < 0.5) score = Math.min(score, 0.7);
  if (s.missingFacts.length > 0) score = Math.min(score, 0.75);

  const band: ReliabilityBand =
    score >= 0.8 ? "high" : score >= 0.6 ? "moderate" : score >= 0.35 ? "low" : "unusable";

  return {
    score: Math.round(score * 100) / 100,
    band,
    humanReviewRequired: band === "low" || band === "unusable" || s.contradictions > 0,
    factors,
    disclaimer:
      "Reliability is a weighted evidence assessment, not a proof of correctness. " +
      "Model self-confidence is one weak input and is never treated as certainty.",
  };
}
