import type { BookSearchLanguage } from "./bookSearch";

const LANGUAGE_KEY = "tsundoku.v2.preferredBookLanguage";
const supported: BookSearchLanguage[] = ["all", "fr", "en", "de", "es", "it"];

export function getPreferredBookLanguage(): BookSearchLanguage {
  if (typeof window === "undefined") return "fr";
  const value = window.localStorage.getItem(LANGUAGE_KEY) as BookSearchLanguage | null;
  return value && supported.includes(value) ? value : "fr";
}

export function setPreferredBookLanguage(language: BookSearchLanguage): void {
  if (typeof window !== "undefined") window.localStorage.setItem(LANGUAGE_KEY, language);
}
