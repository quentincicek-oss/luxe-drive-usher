
# HarborLine — Senior Design & Engineering Audit

Scope: presentation layer only. No new features, no schema/API/auth/business-logic changes. All existing routes, server functions, RLS, Stripe, i18n, concierge sessions and Supabase types remain intact.

---

## 1. Findings by surface

### Global / shell (`__root.tsx`, `styles.css`)
- Root already sets solid metadata + fonts. Good.
- `ConciergeWidget` mounts globally but has no route-level suppression (shows on `/auth`, `/`) — visually competes with the hero CTA.
- Toaster uses `theme="dark"` hardcoded; ignores `ThemeProvider` light mode.
- Design tokens exist but `shadow-luxe` / `shadow-gold` are used inconsistently (some cards use raw `border` + `bg-surface-elevated`, some use `shadow-luxe`, some neither).
- No standardized motion tokens (durations, easings). Ad-hoc `duration-200/300`, `ease-out`, custom keyframes scattered.
- Focus rings missing on many custom buttons/inputs (a11y).

### Landing (`index.tsx`)
- Hero video + logo look strong; the page is dense with decorative layers.
- CTA hierarchy: "Reserve your ride" and "Sign Up" compete — Apple/Uber would pick one primary and one text link.
- Language menu + theme toggle placement inconsistent between landing and app shell.

### Auth (`auth.tsx`)
- Likely uses same input style as `book.tsx` (`rounded-md bg-input border border-border/60 px-3 py-2.5`). Need to standardize on shared `<Field>` + `<Button>` primitives.
- Google button probably not aligned to Apple-like sign-in visual weight.

### Book (`book.tsx`)
- Form container `rounded-xl border bg-surface-elevated shadow-luxe p-8` — OK, but sits alone in a wide viewport; Uber-style booking has stronger visual grouping between "Where / When / Who / Which car".
- Field labels use `text-xs uppercase tracking-widest` — heavy, Mercedes-like but not consistent with body copy. Standardize label typography.
- Number stepper for passengers is a raw `<input type=number>` — replace with a tasteful stepper (still just presentation).
- `VehicleShowroom` is a strong element but its LED/rotation animation may be heavy on mobile — audit for `prefers-reduced-motion` and pause when off-screen.
- Submit button full-width gold gradient is fine; needs pressed/loading micro-states.
- No skeleton while `useAuth` is loading — currently just a blank `bg-obsidian`. Add a proper skeleton.

### History (`history.tsx`)
- Not yet reviewed in this audit pass. Expected issues: list items likely lack rhythm, empty state probably missing, receipt/pay buttons inconsistent with global button system.

### Admin (`admin.tsx`)
- Likely a functional but visually flat table. Needs tabular density rules, sticky header, empty & error states.

### Concierge widget (`ConciergeWidget.tsx`)
- Launcher slogan on the pill is a nice touch; but panel likely has different radii/shadows than the rest of the app.
- Typing indicator + Siri orb are premium; ensure they respect reduced motion.
- Should hide on `/auth` and shrink to icon-only on mobile.

### Modals (`RatingModal`, `ReceiptModal`, `BookingCheckoutModal`)
- Three different modal chromes (borders, radii, close-button positions). Consolidate into one `Modal` primitive.

### Language menu / theme
- `LanguageMenu` has both native `<select>` (mobile) and custom button — good. Verify visual parity with header controls.

### Vehicle showroom
- Seats/Rate already removed. Turntable animations premium; but 3 large PNGs load eagerly. Add `loading="lazy"` + `decoding="async"` and preload only the active one.

---

## 2. Cross-cutting issues

1. **No shared primitives.** Buttons, inputs, labels, cards, modals are re-implemented per screen. Drift is guaranteed.
2. **Spacing scale drift.** `p-6`, `p-8`, `py-10`, `py-14` all appear as section padding with no rule.
3. **Shadow drift.** Some elevated surfaces use `shadow-luxe`, some none, some `shadow-gold` inappropriately (gold glow should be reserved for primary CTA / active states).
4. **Motion drift.** Multiple keyframes, no shared tokens; no global `prefers-reduced-motion` gate for decorative motion.
5. **Focus & a11y.** Custom buttons lack `:focus-visible` rings. Some icon-only buttons lack `aria-label`. Language `<select>` label needed.
6. **Loading & empty states.** Blank `bg-obsidian` divs stand in for skeletons. Empty history / empty admin likely missing.
7. **Performance.** Hero video autoplays always; showroom PNGs eager; fonts loaded with all weights 300–800 (heavy). Trim to 400/500/600/700.
8. **Responsiveness.** Header nav in `book.tsx` uses `hidden sm:block` for brand text — fine — but the row of pills (`LanguageMenu` + history + admin + signout) will crowd on 360px widths.

---

## 3. Implementation plan (incremental, presentation-only)

Each phase is independently shippable; no functionality changes.

### Phase A — Design tokens & primitives (foundation)
1. Extend `styles.css` with motion + spacing + elevation tokens:
   - `--ease-standard`, `--ease-emphasized`, `--dur-fast/med/slow`.
   - `--elev-1/2/3` shadows; retire ad-hoc uses.
   - Add global `:focus-visible` gold ring utility `.focus-luxe`.
   - Reduced-motion global guard for decorative animations (`.motion-safe-only`).
   - Trim Google Fonts weights.
2. Create `src/components/ui/` primitives (thin, reuse existing shadcn where present):
   - `Field` (label + input + helper + error).
   - `Stepper` (for passengers count).
   - `SectionCard` (standard elevated surface).
   - `Modal` (single chrome for Rating/Receipt/Checkout).
   - `IconButton` with built-in `aria-label` requirement.
   - `PrimaryButton` / `SecondaryButton` / `GhostButton` matching Mercedes CTA weight.
3. Add `Skeleton` primitives for auth-loading and list-loading states.

### Phase B — Global shell polish
1. Route-aware `ConciergeWidget`: hide on `/` and `/auth`; icon-only on `<sm`.
2. Toaster reads current theme from `useTheme()`.
3. Standardize header (used by `book`, `history`, `admin`) into one `<AppHeader>` component; keep exact links/handlers.
4. Add global `<main>` landmark per route, single `h1` per page audit.

### Phase C — Route-by-route refit (presentation only)
1. **Landing**: one primary CTA (Reserve), one text link (Sign In). Tighten vertical rhythm, ensure hero is `h-dvh` not `h-screen`. Verify video pauses on reduced motion.
2. **Auth**: replace inputs with `Field`, buttons with `PrimaryButton`; align Google button to Apple weight.
3. **Book**: group form into two `SectionCard`s ("Trip" and "Vehicle"); replace passenger input with `Stepper`; use shared header; add loading skeleton; ensure showroom lazy-loads and honors reduced motion.
4. **History**: apply `SectionCard`, empty state ("No journeys yet — reserve your first ride"), consistent action buttons; standardize receipt/pay entrypoints.
5. **Admin**: sticky table header, zebra rows via tokens, empty/error states, consistent action buttons.

### Phase D — Modals & concierge
1. Migrate `BookingCheckoutModal`, `RatingModal`, `ReceiptModal` to shared `Modal` primitive (same radius, backdrop blur, close affordance, focus trap via shadcn Dialog).
2. Concierge panel: adopt `Modal`/sheet chrome, match input to `Field`, ensure `prefers-reduced-motion` disables Siri orb spin/wave.

### Phase E — Perf & a11y sweep
1. `loading="lazy"` + `decoding="async"` on showroom images; preload only active vehicle.
2. Trim font weights to 400/500/600/700.
3. Add `focus-visible` rings to every interactive element (`.focus-luxe`).
4. Add `aria-label` to every icon-only button; give `LanguageMenu` a visible or `sr-only` label.
5. Replace `h-screen` with `h-dvh` where used.
6. Verify color contrast (`text-muted-foreground` on `bg-surface-elevated` — likely OK, re-check in light theme).

### Phase F — QA
1. Build + typecheck.
2. Playwright visual pass on `/`, `/auth`, `/book`, `/history`, `/admin` at 375px, 768px, 1440px.
3. Reduced-motion smoke: `prefers-reduced-motion: reduce` → hero video paused, orb still, showroom rotation stopped.
4. Confirm no functional regressions: booking insert, chat streaming, Stripe checkout, receipt OTP, admin queries all still call the same handlers.

---

## 4. Guardrails

- No changes to: `src/integrations/supabase/*`, `src/routes/api/*`, `src/lib/*.functions.ts`, `src/lib/*.server.ts`, `supabase/`, `.env`.
- No prop changes on `useAuth`, `useI18n`, `useTheme` — only consumers may change.
- Every translation key referenced today continues to be referenced (no key renames).
- Stripe/Concierge/RLS untouched.

---

## 5. Deliverable order

Ship in this exact order so each PR is safe to preview:

1. Phase A tokens + primitives (no visible change yet).
2. Phase B shell (AppHeader, widget routing, toaster theme).
3. Phase C.1 Landing → C.2 Auth → C.3 Book → C.4 History → C.5 Admin.
4. Phase D modals + concierge chrome.
5. Phase E perf/a11y sweep.
6. Phase F QA + Playwright screenshots.

Approve this plan and I'll start with Phase A.
