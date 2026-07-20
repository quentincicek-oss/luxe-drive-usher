// Loads the Google Maps JS API exactly once, using the async callback pattern
// required for `loading=async`. Safe to call from multiple components.
//
// Browser key is referrer-restricted to *.lovable.app / *.lovableproject.com.
// Custom domains require the user to provision their own key + referrer list.

const SCRIPT_ID = "google-maps-js-loader";

type GoogleMapsGlobal = typeof globalThis & {
  google?: {
    maps?: {
      importLibrary: (name: string) => Promise<unknown>;
    };
  };
  __harborlineGmapsInit?: () => void;
};

let loadPromise: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("google maps unavailable in ssr"));
  }
  const w = window as GoogleMapsGlobal;
  if (w.google?.maps?.importLibrary) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
    | string
    | undefined;
  if (!key) {
    return Promise.reject(
      new Error(
        "Google Maps browser key is not configured. Ensure the Google Maps connector is linked to this project.",
      ),
    );
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    w.__harborlineGmapsInit = () => resolve();

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) return; // callback will fire

    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.async = true;
    s.defer = true;
    const params = new URLSearchParams({
      key,
      v: "weekly",
      libraries: "places",
      loading: "async",
      callback: "__harborlineGmapsInit",
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(s);
  });

  return loadPromise;
}
