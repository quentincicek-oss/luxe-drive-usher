import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(120_000),
      }),
    )
    .min(1)
    .max(200),
  /** Legacy escape hatch: pin a tier instead of a raw model id. */
  tier: z.enum(["fast", "balanced", "deep"]).optional(),
});

/**
 * Legacy NVIDIA NIM entry point, now backed by the adaptive router
 * (src/lib/ai/router.server.ts). The API key stays in server env and is never
 * exposed to the browser; internal chain-of-thought is never returned.
 */
export const nvidiaChat = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { routeChat } = await import("./ai/router.server");
    const result = await routeChat({
      messages: data.messages,
      tier: data.tier,
      taskKind: "assistant",
      purpose: "nvidia_chat_legacy",
    });
    return {
      content: result.content,
      model_used: result.modelUsed,
      tier_used: result.tierUsed,
      fallback_used: result.fallbackUsed,
    };
  });
