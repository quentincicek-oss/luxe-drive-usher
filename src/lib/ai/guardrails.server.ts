/**
 * Deterministic RIE guardrails.
 *
 * Hard operational rules are decided by application code, never by a model.
 * The AI may analyse and recommend; if its recommendation contradicts a
 * deterministic rule, the rule wins and a conflict is reported.
 */

export type RuleDomain =
  | "eligibility"
  | "driver_availability"
  | "ride_state"
  | "required_documents"
  | "safety"
  | "pricing"
  | "assignment"
  | "geographic";

export interface DeterministicRule {
  /** Stable rule id, e.g. "driver.hos_limit". */
  id: string;
  domain: RuleDomain;
  /** Did the deterministic check pass? Computed by application logic, not by AI. */
  passed: boolean;
  /** Plain statement of the rule outcome, shown to admins and fed to the model as fact. */
  statement: string;
  /**
   * Actions this rule forbids when it did not pass, e.g. ["assign_driver", "confirm_ride"].
   * A recommendation matching one of these is overridden.
   */
  forbids?: string[];
}

export interface GuardrailConflict {
  ruleId: string;
  domain: RuleDomain;
  statement: string;
  /** Which forbidden action the AI appeared to recommend. */
  matchedAction: string;
  severity: "blocking" | "advisory";
}

export interface GuardrailOutcome {
  /** Rules that failed their deterministic check. */
  violations: DeterministicRule[];
  conflicts: GuardrailConflict[];
  /** True when AI advice must not be acted on as-is. */
  aiOverridden: boolean;
  /** The action the application will take regardless of AI advice. */
  deterministicDecision: "allowed" | "blocked";
  /** Text block injected into the prompt so the model analyses inside the rules. */
  promptBlock: string;
}

/** Loose textual match: recommendation phrasing varies, rule ids do not. */
function mentionsAction(text: string, action: string): boolean {
  const words = action.toLowerCase().split(/[_\s-]+/).filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const t = text.toLowerCase();
  const negated = new RegExp(
    `(do not|don't|never|cannot|can't|must not|avoid|refrain from|hold off)[^.]{0,40}${words[0]}`,
    "i",
  ).test(text);
  if (negated) return false;
  return words.every((w) => t.includes(w));
}

export function evaluateGuardrails(
  rules: DeterministicRule[],
  aiRecommendation: string,
): GuardrailOutcome {
  const violations = rules.filter((r) => !r.passed);
  const conflicts: GuardrailConflict[] = [];

  for (const rule of violations) {
    for (const action of rule.forbids ?? []) {
      if (mentionsAction(aiRecommendation, action)) {
        conflicts.push({
          ruleId: rule.id,
          domain: rule.domain,
          statement: rule.statement,
          matchedAction: action,
          severity: rule.domain === "safety" || rule.domain === "eligibility" ? "blocking" : "advisory",
        });
      }
    }
  }

  const promptBlock = rules.length
    ? [
        "DETERMINISTIC RULES (authoritative, computed by the application — you may not override, dispute, or work around these):",
        ...rules.map(
          (r) =>
            `- [${r.passed ? "PASS" : "FAIL"}] ${r.id} (${r.domain}): ${r.statement}` +
            (!r.passed && r.forbids?.length ? ` Forbidden while failing: ${r.forbids.join(", ")}.` : ""),
        ),
        "If a rule above fails, do not recommend the actions it forbids. Recommend the compliant alternative or an explicit escalation instead.",
      ].join("\n")
    : "";

  return {
    violations,
    conflicts,
    aiOverridden: conflicts.length > 0,
    deterministicDecision: violations.length > 0 ? "blocked" : "allowed",
    promptBlock,
  };
}
