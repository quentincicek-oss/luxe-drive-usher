import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  kicker?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function SectionCard({ kicker, title, description, children, className }: Props) {
  return (
    <section className={cn("card-luxe p-6 sm:p-8", className)}>
      {(kicker || title || description) && (
        <header className="mb-6">
          {kicker && (
            <div className="text-[10px] tracking-[0.35em] text-gold uppercase">{kicker}</div>
          )}
          {title && <h2 className="mt-2 font-display text-2xl sm:text-3xl">{title}</h2>}
          {description && (
            <p className="mt-2 text-sm text-muted-foreground max-w-prose">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
