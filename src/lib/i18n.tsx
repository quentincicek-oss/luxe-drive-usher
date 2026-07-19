import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const SUPPORTED = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
] as const;

export type Lang = (typeof SUPPORTED)[number]["code"];

type Dict = Record<string, string>;

const en: Dict = {
  "brand.name": "HarborLine",
  "brand.subtitle": "EXECUTIVE SERVICES",
  "brand.tagline": "YOUR JOURNEY. OUR PRIORITY.",
  "cta.signin": "Sign In",
  "cta.signup": "Sign Up",
  "cta.google": "Continue with Google",
  "cta.language": "Change Language",
  "cta.book": "Reserve your ride",
  "cta.continue": "Continue",
  "nav.book": "Book",
  "nav.history": "History",
  "nav.profile": "Profile",
  "nav.admin": "Admin",
  "nav.signout": "Sign out",
  "landing.hero.title": "Executive travel, refined.",
  "landing.hero.body": "A private concierge fleet operating across the United States. Chauffeured Cadillac Escalade, Chevrolet Suburban, and GMC Denali — reserved in seconds, delivered on time, every time.",
  "landing.features.drivers": "Professional Drivers",
  "landing.features.booking": "Easy Booking",
  "landing.features.reliable": "Reliable & Insured",
  "landing.features.luxury": "Luxury Experience",
  "landing.features.global": "Local & Global",
  "landing.fleet": "The Fleet",
  "landing.contact": "Contact",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.name": "First name",
  "auth.surname": "Last name",
  "auth.phone": "Phone",
  "auth.create": "Create account",
  "auth.have": "Already have an account?",
  "auth.need": "New to HarborLine?",
  "book.title": "Reserve a Ride",
  "book.pickup": "Pickup location",
  "book.dropoff": "Dropoff location",
  "book.time": "Pickup time",
  "book.passengers": "Passengers",
  "book.ride": "Vehicle",
  "book.notes": "Notes for chauffeur",
  "book.submit": "Confirm reservation",
  "book.blake": "Concierge",
  "book.blake.hint": "Chat with our AI concierge to book, get quotes, or ask anything about your ride.",
  "book.blake.placeholder": "How may I be of service?",
  "book.send": "Send",
};

const tr: Dict = {
  "brand.name": "HarborLine",
  "brand.subtitle": "EXECUTIVE SERVICES",
  "brand.tagline": "YOLCULUĞUNUZ. ÖNCELİĞİMİZ.",
  "cta.signin": "Giriş Yap",
  "cta.signup": "Kayıt Ol",
  "cta.google": "Google ile devam et",
  "cta.language": "Dil Değiştir",
  "cta.book": "Aracını rezerve et",
  "cta.continue": "Devam",
  "nav.book": "Rezervasyon",
  "nav.history": "Geçmiş",
  "nav.profile": "Profil",
  "nav.admin": "Yönetim",
  "nav.signout": "Çıkış",
  "landing.hero.title": "Rafine yönetici seyahati.",
  "landing.hero.body": "Amerika genelinde çalışan özel bir concierge filo. Şoförlü Cadillac Escalade, Chevrolet Suburban ve GMC Denali — saniyeler içinde rezerve edilir, her seferinde zamanında teslim edilir.",
  "landing.features.drivers": "Profesyonel Sürücüler",
  "landing.features.booking": "Kolay Rezervasyon",
  "landing.features.reliable": "Güvenilir & Sigortalı",
  "landing.features.luxury": "Lüks Deneyim",
  "landing.features.global": "Yerel & Global",
  "landing.fleet": "Filo",
  "landing.contact": "İletişim",
  "auth.email": "E-posta",
  "auth.password": "Şifre",
  "auth.name": "Ad",
  "auth.surname": "Soyad",
  "auth.phone": "Telefon",
  "auth.create": "Hesap oluştur",
  "auth.have": "Zaten hesabın var mı?",
  "auth.need": "HarborLine'da yeni misin?",
  "book.title": "Rezervasyon",
  "book.pickup": "Alış noktası",
  "book.dropoff": "Bırakış noktası",
  "book.time": "Alış zamanı",
  "book.passengers": "Yolcu sayısı",
  "book.ride": "Araç",
  "book.notes": "Şoför için notlar",
  "book.submit": "Rezervasyonu onayla",
  "book.blake": "Concierge",
  "book.blake.hint": "AI concierge ile sohbet et — rezervasyon yap, fiyat al, sorularını yanıtla.",
  "book.blake.placeholder": "Size nasıl yardımcı olabilirim?",
  "book.send": "Gönder",
};

const dicts: Record<string, Dict> = { en, tr };

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: string) => string;
}
const I18n = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const stored = localStorage.getItem("hl_lang") as Lang | null;
    if (stored) { setLangState(stored); return; }
    const device = navigator.language?.slice(0, 2).toLowerCase();
    const match = SUPPORTED.find((s) => s.code === device);
    if (match) setLangState(match.code as Lang);
  }, []);
  const setLang = (l: Lang) => { localStorage.setItem("hl_lang", l); setLangState(l); };
  const t = useMemo(() => (k: string) => (dicts[lang] ?? en)[k] ?? en[k] ?? k, [lang]);
  return <I18n.Provider value={{ lang, setLang, t }}>{children}</I18n.Provider>;
}

export function useI18n() {
  const c = useContext(I18n);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
