import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Current active versions of legal surfaces.
 * When you publish a new version, insert a row in `public.legal_documents`
 * with the new (kind, version) and bump the constant below. Users then get
 * prompted to re-accept next time they sign in.
 */
export const CURRENT_LEGAL_VERSIONS = {
  terms: "2026-07-01",
  privacy: "2026-07-01",
  dpa: "2026-07-01",
  cookies: "2026-07-01",
} as const;

export type LegalKind = keyof typeof CURRENT_LEGAL_VERSIONS;

const AcceptInput = z.object({
  kind: z.enum(["terms", "privacy", "dpa", "cookies"]),
  version: z.string().min(1).max(40),
});

export const recordLegalAcceptance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AcceptInput.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("record_legal_acceptance", {
      _kind: data.kind,
      _version: data.version,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const getMyLegalAcceptances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("legal_acceptances")
      .select("kind, version, accepted_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { acceptances: data ?? [], current: CURRENT_LEGAL_VERSIONS };
  });
