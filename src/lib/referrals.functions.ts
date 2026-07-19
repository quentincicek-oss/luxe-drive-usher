import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Ensures the signed-in user owns exactly one active referral code and returns it.
export const getOrCreateMyReferralCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const existing = await (supabase as any).from("referral_codes")
      .select("*").eq("owner_user_id", userId).eq("active", true).maybeSingle();
    if (existing.data) return existing.data;

    // Get active campaign (most recent).
    const camp = await (supabase as any).from("referral_campaigns")
      .select("id").eq("active", true)
      .lte("starts_at", new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    // Generate 8-char code
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];

    const ins = await (supabase as any).from("referral_codes").insert({
      code, owner_user_id: userId, campaign_id: camp.data?.id ?? null, active: true,
    }).select("*").single();
    if (ins.error) throw new Error(ins.error.message);
    return ins.data;
  });

// Signed-in user calls this after auth completes with a code they visited via NFC/QR/link.
export const claimReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; source: "nfc" | "qr" | "link" }) =>
    z.object({ code: z.string().min(4).max(20), source: z.enum(["nfc","qr","link"]) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const codeRow = await (supabaseAdmin as any).from("referral_codes")
      .select("*").eq("code", data.code).eq("active", true).maybeSingle();
    if (!codeRow.data) return { ok: false, reason: "invalid_code" };
    if (codeRow.data.owner_user_id === userId) return { ok: false, reason: "self_referral" };

    // Already claimed?
    const existing = await (supabaseAdmin as any).from("referrals")
      .select("id").eq("referred_user_id", userId).maybeSingle();
    if (existing.data) return { ok: false, reason: "already_referred" };

    // Enforce per_referrer_limit if configured
    if (codeRow.data.campaign_id) {
      const camp = await (supabaseAdmin as any).from("referral_campaigns")
        .select("per_referrer_limit,active,ends_at,reward_percent,reward_flat_amount,reward_validity_days")
        .eq("id", codeRow.data.campaign_id).maybeSingle();
      if (!camp.data?.active) return { ok: false, reason: "campaign_inactive" };
      if (camp.data.ends_at && new Date(camp.data.ends_at) < new Date()) return { ok: false, reason: "campaign_ended" };
      if (camp.data.per_referrer_limit) {
        const count = await (supabaseAdmin as any).from("referrals")
          .select("id", { count: "exact", head: true })
          .eq("referrer_user_id", codeRow.data.owner_user_id);
        if ((count.count ?? 0) >= camp.data.per_referrer_limit) return { ok: false, reason: "limit_reached" };
      }
    }

    const ins = await (supabaseAdmin as any).from("referrals").insert({
      referrer_user_id: codeRow.data.owner_user_id,
      referred_user_id: userId,
      code_id: codeRow.data.id,
      campaign_id: codeRow.data.campaign_id,
      source: data.source,
      status: "converted",
      converted_at: new Date().toISOString(),
    }).select("id, campaign_id").single();
    if (ins.error) return { ok: false, reason: ins.error.message };

    // Issue rewards to both referrer + referred based on campaign
    if (ins.data.campaign_id) {
      const camp = await (supabaseAdmin as any).from("referral_campaigns")
        .select("reward_percent,reward_flat_amount,reward_validity_days")
        .eq("id", ins.data.campaign_id).maybeSingle();
      if (camp.data) {
        const expires = new Date();
        expires.setDate(expires.getDate() + (camp.data.reward_validity_days ?? 90));
        await (supabaseAdmin as any).from("referral_rewards").insert([
          { referral_id: ins.data.id, recipient_user_id: codeRow.data.owner_user_id, campaign_id: ins.data.campaign_id,
            amount_percent: camp.data.reward_percent, amount_flat: camp.data.reward_flat_amount, expires_at: expires.toISOString() },
          { referral_id: ins.data.id, recipient_user_id: userId, campaign_id: ins.data.campaign_id,
            amount_percent: camp.data.reward_percent, amount_flat: camp.data.reward_flat_amount, expires_at: expires.toISOString() },
        ]);
      }
    }
    return { ok: true, referralId: ins.data.id };
  });
