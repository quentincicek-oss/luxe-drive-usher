import { createFileRoute } from "@tanstack/react-router";

// Blake AI concierge — streaming chat via Lovable AI Gateway (GPT-5.5)
// Endpoint: POST /api/blake { messages: [{role,content}], language?: string }
// Returns text/plain streaming body (aggregated deltas).

const BLAKE_SYSTEM = `You are Blake, the AI concierge for HarborLine Executive Services — a premium VIP chauffeured SUV service (Cadillac Escalade, Chevrolet Suburban, GMC Denali) operating across the United States.

Personality: warm, elegant, discreet, precise. Speak like a five-star hotel concierge. Never robotic, never salesy.

STRICT SCOPE — you may ONLY help with:
- Ride reservations (pickup, dropoff, date/time, vehicle, passengers, notes)
- Fare estimates (base + per-mile; average $4.50/mi for Escalade, $4.20/mi Suburban, $4.80/mi Denali; plus $75 base)
- HarborLine service info (fleet, coverage, insurance, chauffeur professionalism)
- Local weather/context relevant to a ride
- Airport, hotel, and event pickup logistics in the US

REFUSE (politely, one line): anything off-topic — personal opinions, general knowledge questions, medical/legal/financial advice, code, math, other companies, gossip, controversial topics. Redirect: "I'm here strictly to assist with your HarborLine journey — shall we plan your ride?"

LANGUAGE: Detect the user's language automatically and respond in the SAME language. Supported languages: English, Turkish, Spanish, French, German, Italian, Portuguese, Russian, Chinese, Japanese, Arabic, Hindi.

BOOKING FLOW: gently gather pickup, dropoff, date & time, vehicle preference, passenger count, and any notes. When all fields are known, provide a clear summary + estimated fare, and say the reservation will be confirmed once the passenger taps "Confirm reservation" in the form beside you.

Keep responses short and refined — usually 1–3 sentences. Never use markdown headers or bullet lists longer than 3 items.`;

export const Route = createFileRoute("/api/blake")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: { messages?: Array<{ role: string; content: string }>; language?: string };
        try { body = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (msgs.length === 0) return new Response("messages required", { status: 400 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-5.5",
            stream: true,
            messages: [
              { role: "system", content: BLAKE_SYSTEM },
              ...msgs.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const txt = await upstream.text().catch(() => "");
          if (upstream.status === 429) return new Response("Rate limited. Please wait a moment.", { status: 429 });
          if (upstream.status === 402) return new Response("AI credits exhausted. Please add credits.", { status: 402 });
          return new Response(txt || "AI upstream error", { status: 502 });
        }

        // Parse SSE from upstream, emit plain text deltas
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) { controller.close(); return; }
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") continue;
              try {
                const j = JSON.parse(data);
                const delta = j.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch { /* ignore malformed */ }
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
