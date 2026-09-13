import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
  model: z.string().min(1).max(120).optional(),
});

/**
 * NVIDIA NIM chat completion. The API key lives only in server env
 * (NVIDIA_API_KEY) and is never exposed to the browser.
 */
export const nvidiaChat = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env["NVIDIA_API_KEY"];
    if (!key) throw new Error("NVIDIA_API_KEY is not configured");

    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: data.model ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        messages: data.messages,
        temperature: 0.4,
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`NVIDIA NIM request failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { content: json.choices?.[0]?.message?.content ?? "" };
  });
