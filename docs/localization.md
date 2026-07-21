# Localization

HarborLine ships with a lightweight `useI18n()` hook backed by dictionaries in
`src/lib/i18n.tsx`. English (`en`) and Turkish (`tr`) are the two guaranteed-
complete locales for release. Additional locales (`es`, `pt`, `zh`, `it`) are
loaded from the same file but may fall back to English for missing keys.

## Key namespaces (Batch A additions)

- `cookies.*` — cookie consent banner labels and category names.
- `legal.terms.*`, `legal.privacy.*`, `legal.dpa.*`, `legal.cookies.*` — legal
  surface headings and paragraph copy.
- `legal.back_home`, `legal.version`, `legal.owner_note` — shared legal chrome.
- `admin.recovery.*` — MFA recovery generation and consumption UI.

## Adding a translation

1. Add the key + English string to the `en` dictionary in `src/lib/i18n.tsx`.
2. Add a Turkish translation to the `tr` dictionary. Missing keys fall back
   to English but never to `undefined`.
3. Other locales inherit the English fallback. Fill them in when a market is
   activated.

## Rules

- No user-facing string is hard-coded inside a component after Batch A;
  always route through `t(...)`.
- Format numbers, currencies, and dates with `Intl.*` and pass the active
  locale from `useI18n().locale`.
- Do not translate machine identifiers, secret names, or audit log actions.
