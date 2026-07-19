import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DriverShell } from "@/components/driver/DriverShell";
import { DocumentRow } from "@/components/driver/DocumentRow";

export const Route = createFileRoute("/_driver/documents")({
  component: DriverDocuments,
});

function DriverDocuments() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["driver", "documents", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: profile } = await (supabase as any)
        .from("driver_profiles").select("id").eq("user_id", user!.id).maybeSingle();
      if (!profile) return [];
      const { data } = await (supabase as any)
        .from("driver_documents")
        .select("*")
        .eq("driver_id", profile.id)
        .order("kind");
      return data ?? [];
    },
  });

  const docs = q.data ?? [];

  return (
    <DriverShell title="Documents">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Documents are managed by HarborLine administrators. Contact dispatch to update.
        </p>
        {docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
            No documents on file yet.
          </div>
        ) : (
          docs.map((d: any) => (
            <DocumentRow
              key={d.id}
              kind={d.kind}
              documentNumber={d.document_number}
              expiresAt={d.expires_at}
              status={d.status}
            />
          ))
        )}
      </div>
    </DriverShell>
  );
}
