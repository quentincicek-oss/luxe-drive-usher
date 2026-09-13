import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/r/$code")({
  head: () => ({
    meta: [
      { title: "Referral Invitation | HarborLine Executive" },
      { name: "description", content: "Claim your HarborLine Executive Services referral invitation." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Referral Invitation | HarborLine Executive" },
      { property: "og:description", content: "Claim your HarborLine Executive Services referral invitation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    src: (typeof s.src === "string" ? s.src : "link") as "nfc" | "qr" | "link",
  }),
  component: ReferralCapture,
});

function ReferralCapture() {
  const { code } = Route.useParams();
  const { src } = Route.useSearch();
  const nav = useNavigate();

  useEffect(() => {
    try {
      sessionStorage.setItem("harborline.referral", JSON.stringify({
        code, source: src, capturedAt: new Date().toISOString(),
      }));
    } catch { /* noop */ }
    nav({ to: "/auth" });
  }, [code, src, nav]);

  return (
    <main className="min-h-dvh bg-obsidian flex items-center justify-center">
      <div className="text-center">
        <div className="font-display text-3xl text-gradient-gold mb-2">HarborLine</div>
        <div className="text-sm text-muted-foreground">Preparing your invitation…</div>
      </div>
    </main>
  );
}
