/**
 * AI Router self-test scenarios. Browser-safe: it only describes the calls the
 * admin panel makes through the real aiChat / aiAnalyze entry points.
 */

export interface Scenario {
  id: string;
  label: string;
  kind: "chat" | "analyze";
  /** Expectations checked client-side against the server response. */
  expect: {
    tier?: "fast" | "balanced" | "deep";
    minTier?: "fast" | "balanced" | "deep";
    escalated?: boolean;
    overridden?: boolean;
    protectedPinned?: boolean;
    summarized?: boolean;
    shouldFail?: boolean;
  };
  payload: Record<string, unknown>;
}

const RIDE_STATE = {
  booking_id: "HB-88421",
  ride_state: "assigned",
  pickup: "JFK Terminal 4, Queens NY",
  dropoff: "The Peninsula, 700 Fifth Ave, Manhattan NY",
  pickup_at: "2026-09-14T19:00:00-04:00",
  assigned_driver: "Marcus D. (driver_id d-2291)",
  vehicle: "Cadillac Escalade",
  passengers: 4,
  distance_miles: 18,
  pricing_inputs: { base_cents: 7500, per_mile_cents: 450 },
  constraints: ["child seat required", "no highway tolls billed to guest"],
  incidents: [],
  selected_options: ["meet & greet", "bottled water"],
};

const longConversation = () =>
  Array.from({ length: 46 }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content:
      `Turn ${i}: the guest and concierge discussed terminal access, luggage handling, and waiting areas at length. ` +
      "Additional pleasantries and repeated logistics chatter follow. ".repeat(60),
  }));

export const SCENARIOS: Scenario[] = [
  {
    id: "A",
    label: "Simple FAST request",
    kind: "chat",
    expect: { tier: "fast" },
    payload: {
      messages: [{ role: "user", content: "Translate to Turkish, one line: Your chauffeur is waiting at Terminal 4." }],
      taskKind: "assistant",
      purpose: "selftest_A",
    },
  },
  {
    id: "B",
    label: "Normal BALANCED RIE analysis",
    kind: "analyze",
    expect: { tier: "balanced" },
    payload: {
      question: "Is this airport pickup plan sound, and what should the chauffeur do on arrival?",
      facts: {
        airport: "JFK (New York)",
        flight: "AA100",
        terminal: "4",
        flight_scheduled_arrival: "2026-09-14T18:20-04:00",
        flight_status: "on time",
        pickup_at: "2026-09-14T19:00-04:00",
        passengers: 4,
        luggage: "4 checked, 4 carry-on",
        vehicle: "Cadillac Escalade (7 seats)",
        distance_miles: 18,
        driver: "Marcus D., currently 12 min from JFK",
        guest_phone: "on file",
        meet_and_greet: true,
        contingency: "90 min free wait on international arrivals",
      },
      requiredFacts: [
        "airport", "flight", "terminal", "flight_scheduled_arrival", "flight_status", "pickup_at",
        "passengers", "luggage", "vehicle", "distance_miles", "driver", "guest_phone",
        "meet_and_greet", "contingency",
      ],
      purpose: "selftest_B",
    },
  },
  {
    id: "C",
    label: "Complex request escalating to DEEP",
    kind: "analyze",
    expect: { tier: "deep" },
    payload: {
      question:
        "Two VIP airport pickups conflict: both guests want the same Escalade at 19:00, one has a missed flight risk and the other is a wedding party. Plan the dispatch strategy and explain the trade-offs.",
      facts: {
        vehicles_available: 1,
        guest_a: { type: "vip", risk: "missed flight" },
        guest_b: { type: "wedding", hard_deadline: "19:45" },
        drivers_on_shift: 1,
      },
      requiredFacts: ["vehicles_available", "guest_a", "guest_b", "drivers_on_shift"],
      purpose: "selftest_C",
    },
  },
  {
    id: "D",
    label: "Malformed / insufficient input",
    kind: "analyze",
    expect: { shouldFail: true },
    payload: { question: "", purpose: "selftest_D" },
  },
  {
    id: "E",
    label: "Forced fallback (unavailable primary)",
    kind: "chat",
    expect: { tier: "fast" },
    payload: {
      messages: [{ role: "user", content: "Reply with exactly: FALLBACK OK" }],
      taskKind: "assistant",
      tier: "fast",
      purpose: "selftest_E_fallback",
    },
  },
  {
    id: "F",
    label: "Structured JSON contract",
    kind: "analyze",
    expect: {},
    payload: {
      question: "Summarise the fare basis for this ride and state the recommended action.",
      facts: { base_cents: 7500, per_mile_cents: 450, distance_miles: 18 },
      requiredFacts: ["base_cents", "per_mile_cents", "distance_miles"],
      purpose: "selftest_F",
    },
  },
  {
    id: "G",
    label: "Long conversation requiring compression",
    kind: "chat",
    expect: { summarized: true, protectedPinned: true },
    payload: {
      messages: [
        ...longConversation(),
        {
          role: "user",
          content:
            "In under 60 words: state the assigned driver, pickup location, pickup time and passenger count exactly as given in the authoritative state.",
        },
      ],
      taskKind: "assistant",
      protectedContext: RIDE_STATE,
      purpose: "selftest_G",
    },
  },
  {
    id: "H",
    label: "Low-confidence escalation",
    kind: "analyze",
    expect: { escalated: true },
    payload: {
      question:
        "Should we assign a driver for this ride? Facts are deliberately incomplete and constraints conflict with each other.",
      facts: { pickup: "unknown", note: "guest may or may not be arriving; two conflicting pickup times reported" },
      requiredFacts: ["pickup", "pickup_at", "passengers", "vehicle", "driver_id"],
      purpose: "selftest_H",
    },
  },
  {
    id: "I",
    label: "Deterministic rule conflict override",
    kind: "analyze",
    expect: { overridden: true },
    payload: {
      question:
        "The guest is waiting. Please recommend that we assign driver d-2291 right now so the ride can start immediately.",
      facts: { driver_id: "d-2291", guest_waiting: true, ride_state: "pending" },
      requiredFacts: ["driver_id", "guest_waiting", "ride_state"],
      rules: [
        {
          id: "driver.documents_expired",
          domain: "required_documents",
          passed: false,
          statement: "Driver d-2291's livery insurance certificate expired on 2026-09-01; the driver is not assignable.",
          forbids: ["assign driver", "start ride"],
        },
        {
          id: "safety.rest_period",
          domain: "safety",
          passed: false,
          statement: "Driver d-2291 has driven 11h in the last 14h and must rest before another assignment.",
          forbids: ["assign driver"],
        },
      ],
      purpose: "selftest_I",
    },
  },
  {
    id: "J",
    label: "Simultaneous requests",
    kind: "chat",
    expect: { tier: "fast" },
    payload: {
      messages: [{ role: "user", content: "Reply with exactly: CONCURRENT OK" }],
      taskKind: "assistant",
      tier: "fast",
      purpose: "selftest_J",
    },
  },
];
