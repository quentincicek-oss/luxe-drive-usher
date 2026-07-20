import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Json | null; error: { message: string } | null }>;
};
const asRpc = (s: unknown) => s as RpcClient;

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>): Promise<Json | null> {
  const { data, error } = await asRpc(supabase).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------- Passenger ----------------

export const supportOpenConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { category: string; subject: string; firstMessage: string; bookingId?: string | null }) =>
    z.object({
      category: z.string().min(1).max(64),
      subject: z.string().trim().min(2).max(200),
      firstMessage: z.string().trim().min(1).max(4000),
      bookingId: z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "support_open_conversation", {
      _category: data.category,
      _subject: data.subject,
      _first_message: data.firstMessage,
      _booking_id: data.bookingId ?? null,
    }),
  );

export const supportSendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; body: string }) =>
    z.object({
      conversationId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "support_send_message", {
      _conversation_id: data.conversationId,
      _body: data.body,
    }),
  );

export const supportMarkRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string }) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await callRpc(context.supabase, "support_mark_read", { _conversation_id: data.conversationId });
    return { ok: true };
  });

// ---------------- Admin ----------------

export const adminSupportReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; body: string; internal?: boolean }) =>
    z.object({
      conversationId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
      internal: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_support_reply", {
      _conversation_id: data.conversationId,
      _body: data.body,
      _internal: data.internal ?? false,
    }),
  );

export const adminSupportSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; status: "open" | "pending" | "resolved" }) =>
    z.object({
      conversationId: z.string().uuid(),
      status: z.enum(["open", "pending", "resolved"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_support_set_status", {
      _conversation_id: data.conversationId,
      _status: data.status,
    }),
  );

export const adminSupportAssign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string; assigneeId: string | null }) =>
    z.object({
      conversationId: z.string().uuid(),
      assigneeId: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_support_assign", {
      _conversation_id: data.conversationId,
      _assignee: data.assigneeId,
    }),
  );

// ---------------- Support settings (public-safe read + admin update) ----------------

export const adminUpdateSupportSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    payload: {
      whatsapp_enabled: boolean; whatsapp_phone_e164?: string | null; whatsapp_template?: string | null;
      email_enabled: boolean; email_address?: string | null;
      operating_hours?: string | null; emergency_message?: string | null; fallback_message?: string | null;
    };
  }) =>
    z.object({
      payload: z.object({
        whatsapp_enabled: z.boolean(),
        whatsapp_phone_e164: z.string().max(20).nullable().optional(),
        whatsapp_template: z.string().max(500).nullable().optional(),
        email_enabled: z.boolean(),
        email_address: z.string().max(255).nullable().optional(),
        operating_hours: z.string().max(200).nullable().optional(),
        emergency_message: z.string().max(500).nullable().optional(),
        fallback_message: z.string().max(1000).nullable().optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ data, context }) =>
    callRpc(context.supabase, "admin_update_support_settings", { _payload: data.payload }),
  );
