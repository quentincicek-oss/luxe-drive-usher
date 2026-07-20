import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  leading?: ReactNode;
  error?: string | null;
};

export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, hint, leading, error, className, id, required, ...rest },
  ref,
) {
  const inputId = id ?? label.replace(/\s+/g, "-").toLowerCase();
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div>
      <label htmlFor={inputId} className="label-luxe">
        {label}
        {required && <span className="text-gold ml-0.5">*</span>}
      </label>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
            {leading}
          </span>
        )}
        <input
          id={inputId}
          ref={ref}
          required={required}
          aria-invalid={!!error || undefined}
          aria-describedby={errId}
          className={cn(
            "input-luxe",
            leading && "pl-9",
            error && "border-destructive/70 focus:border-destructive",
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={errId} className="mt-1.5 text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
});
