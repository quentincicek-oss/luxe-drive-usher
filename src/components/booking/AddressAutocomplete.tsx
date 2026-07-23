import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Loader2, X } from "lucide-react";
import { loadGoogleMaps } from "@/lib/googleMapsLoader";

// Uber-style address input: types-ahead suggestions in a floating dropdown,
// keyboard navigable, and returns a fully structured address on selection.

export type StructuredAddress = {
  formatted: string;              // human-readable single-line address
  placeId: string;
  lat: number | null;
  lng: number | null;
  components: {
    street_number?: string;
    route?: string;
    subpremise?: string;
    locality?: string;            // city
    admin_area_level_1?: string;  // state / region
    admin_area_level_2?: string;  // county
    country?: string;             // country long name
    country_code?: string;        // ISO 3166-1 alpha-2
    postal_code?: string;
  };
};

type Suggestion = {
  placeId: string;
  primary: string;
  secondary: string;
  raw: unknown; // google.maps.places.PlacePrediction
};

// Minimal shape of the Places New API surface we use — typed loosely to avoid
// pulling @types/google.maps into the project.
type GMaps = {
  places: {
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: (req: unknown) => Promise<{ suggestions: unknown[] }>;
    };
    AutocompleteSessionToken: new () => unknown;
  };
};

interface Props {
  label: string;
  value: string;
  onTextChange: (v: string) => void;
  onSelect: (a: StructuredAddress) => void;
  onClear?: () => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  autoFocus?: boolean;
  name?: string;
  autoComplete?: string;
}

export function AddressAutocomplete({
  label,
  value,
  onTextChange,
  onSelect,
  onClear,
  placeholder,
  required,
  error,
  autoFocus,
  name,
  autoComplete = "off",
}: Props) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const sessionTokenRef = useRef<unknown>(null);
  const gmapsRef = useRef<GMaps | null>(null);
  // Client-side quota guard: cap Google Places autocomplete requests at 30 per
  // rolling 60s window per component instance. Prevents runaway typing loops
  // from burning through the daily Places quota.
  const requestTimestampsRef = useRef<number[]>([]);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [libError, setLibError] = useState<string | null>(null);

  // Preload Google Maps JS the first time this component mounts. If the key
  // is missing or blocked, we degrade to a plain text input silently — the
  // user can still type an address by hand and the server accepts it.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(async () => {
        if (cancelled) return;
        const g = (window as unknown as { google: { maps: { importLibrary: (n: string) => Promise<unknown> } } }).google;
        const places = (await g.maps.importLibrary("places")) as GMaps["places"];
        gmapsRef.current = { places };
        sessionTokenRef.current = new places.AutocompleteSessionToken();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLibError(e instanceof Error ? e.message : "maps unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside closes the popover.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fetchSuggestions = useCallback(async (input: string) => {
    const gmaps = gmapsRef.current;
    // Require at least 3 characters — reduces low-signal Places calls.
    if (!gmaps || !input || input.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    // Rolling 60s / 30 request tap. If exceeded, skip silently.
    const now = Date.now();
    const cutoff = now - 60_000;
    requestTimestampsRef.current = requestTimestampsRef.current.filter((t) => t > cutoff);
    if (requestTimestampsRef.current.length >= 30) {
      setLoading(false);
      return;
    }
    requestTimestampsRef.current.push(now);
    setLoading(true);
    try {
      const { suggestions } = await gmaps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionTokenRef.current,
        includedPrimaryTypes: undefined, // let Google decide (addresses + POIs)
      });
      const mapped: Suggestion[] = suggestions
        .map((s: unknown) => {
          const pred = (s as { placePrediction?: unknown }).placePrediction as
            | {
                placeId: string;
                mainText?: { text?: string };
                secondaryText?: { text?: string };
                text?: { text?: string };
              }
            | undefined;
          if (!pred) return null;
          return {
            placeId: pred.placeId,
            primary: pred.mainText?.text ?? pred.text?.text ?? "",
            secondary: pred.secondaryText?.text ?? "",
            raw: pred,
          } as Suggestion;
        })
        .filter((x): x is Suggestion => !!x && !!x.placeId);
      setSuggestions(mapped);
      setActive(mapped.length > 0 ? 0 : -1);
    } catch (e) {
      // Silently swallow — user can still type manually. Log for debugging.
      console.warn("[address-autocomplete] fetch failed", e);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onTextChange(v);
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void fetchSuggestions(v);
    }, 300);
  }

  async function choose(s: Suggestion) {
    const gmaps = gmapsRef.current;
    if (!gmaps) return;
    setOpen(false);
    setSuggestions([]);
    setLoading(true);
    try {
      // Fetch place details for structured components + coordinates.
      // Use the modern Place class (Places API New).
      const g = (window as unknown as {
        google: {
          maps: {
            importLibrary: (n: string) => Promise<{ Place: new (arg: { id: string; requestedLanguage?: string }) => unknown }>;
          };
        };
      }).google;
      const placesLib = await g.maps.importLibrary("places");
      const { Place } = placesLib as { Place: new (arg: { id: string }) => {
        fetchFields: (opts: { fields: string[] }) => Promise<void>;
        formattedAddress?: string;
        addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>;
        location?: { lat: () => number; lng: () => number };
      } };

      const place = new Place({ id: s.placeId });
      await place.fetchFields({
        fields: [
          "formattedAddress",
          "addressComponents",
          "location",
        ],
      });

      const components: StructuredAddress["components"] = {};
      for (const c of place.addressComponents ?? []) {
        for (const t of c.types) {
          if (t === "street_number") components.street_number = c.longText;
          else if (t === "route") components.route = c.longText;
          else if (t === "subpremise") components.subpremise = c.longText;
          else if (t === "locality") components.locality = c.longText;
          else if (t === "postal_town" && !components.locality) components.locality = c.longText;
          else if (t === "administrative_area_level_1") components.admin_area_level_1 = c.shortText || c.longText;
          else if (t === "administrative_area_level_2") components.admin_area_level_2 = c.longText;
          else if (t === "country") {
            components.country = c.longText;
            components.country_code = c.shortText;
          } else if (t === "postal_code") components.postal_code = c.longText;
        }
      }

      const formatted =
        place.formattedAddress ??
        [s.primary, s.secondary].filter(Boolean).join(", ");

      const lat = place.location?.lat?.() ?? null;
      const lng = place.location?.lng?.() ?? null;

      onTextChange(formatted);
      onSelect({
        formatted,
        placeId: s.placeId,
        lat,
        lng,
        components,
      });

      // Reset session token — one per completed selection per Google guidance.
      const places = gmaps.places;
      sessionTokenRef.current = new places.AutocompleteSessionToken();
    } catch (e) {
      console.warn("[address-autocomplete] details failed", e);
      // Fallback: still commit the primary text so form isn't left empty.
      const formatted = [s.primary, s.secondary].filter(Boolean).join(", ");
      onTextChange(formatted);
      onSelect({
        formatted,
        placeId: s.placeId,
        lat: null,
        lng: null,
        components: {},
      });
    } finally {
      setLoading(false);
      inputRef.current?.blur();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      if (active >= 0) {
        e.preventDefault();
        void choose(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && (loading || suggestions.length > 0);
  const describedBy = useMemo(
    () => (error ? `${inputId}-err` : undefined),
    [error, inputId],
  );

  return (
    <div className="w-full" ref={wrapRef}>
      <label htmlFor={inputId} className="label-luxe">
        {label}
        {required && <span className="text-gold ml-0.5">*</span>}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <MapPin className="h-4 w-4" />
        </span>
        <input
          id={inputId}
          ref={inputRef}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 && suggestions[active]
              ? `${listId}-${active}`
              : undefined
          }
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={handleChange}
          onFocus={() => value.length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
          className={
            "w-full min-h-11 rounded-lg border bg-input pl-10 pr-10 py-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-gold/40 " +
            (error ? "border-destructive/70 focus:border-destructive" : "border-border/60 focus:border-gold")
          }
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onTextChange("");
              onClear?.();
              setSuggestions([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear address"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {loading && (
          <span className="absolute right-9 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}

        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-40 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-border/60 bg-background/95 backdrop-blur-xl shadow-luxe"
          >
            {suggestions.length === 0 && loading && (
              <li className="px-4 py-3 text-xs text-muted-foreground">Searching…</li>
            )}
            {suggestions.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focus for mobile
                  void choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition " +
                  (i === active ? "bg-accent/60" : "hover:bg-accent/40")
                }
              >
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-gold" />
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{s.primary}</div>
                  {s.secondary && (
                    <div className="text-xs text-muted-foreground truncate">
                      {s.secondary}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p id={`${inputId}-err`} className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      {libError && !error && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Address suggestions are unavailable — you can type the address manually.
        </p>
      )}
    </div>
  );
}
