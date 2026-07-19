import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  leading?: ReactNode;
};

export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, hint, leading, className, id, ...rest },
  ref,
) {
  const inputId = id ?? label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div>
      <label htmlFor={inputId} className="label-luxe">{label}</label>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
            {leading}
          </span>
        )}
        <input
          id={inputId}
          ref={ref}
          className={cn("input-luxe", leading && "pl-9", className)}
          {...rest}
        />
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
});
