import { normalizeText } from "@tsundoku/book-sources";

export interface AuthorInfo {
  /** Courte description (« écrivain américain »). */
  description?: string;
  /** Résumé biographique. */
  bio?: string;
  photoUrl?: string;
  pageUrl?: string;
  birthYear?: number;
  deathYear?: number;
  workCount?: number;
  source: "wikipedia" | "open-library";
}

export interface WikipediaSummary {
  type?: string;
  title?: string;
  description?: string;
  extract?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
}

export interface OpenLibraryAuthor {
  name?: string;
  birth_date?: string;
  death_date?: string;
  work_count?: number;
  bio?: string | { value?: string };
  photos?: number[];
}

/** Métiers du livre : écarte les homonymes (un footballeur, une commune…). */
const BOOK_TRADE = /(écrivain|auteur|autrice|romancier|romancière|dramaturge|poète|poétesse|scénariste|dessinateur|dessinatrice|illustrateur|illustratrice|mangaka|essayiste|journaliste|nouvelliste|bédéiste|traducteur|traductrice|biochimiste|philosophe|historien|historienne)/i;

const yearIn = (text?: string): number | undefined => {
  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(text ?? "");
  return match ? Number(match[1]) : undefined;
};

/** « écrivain russe naturalisé américain (1920–1992) » → 1920, 1992. */
export function yearsFromDescription(description?: string): { birthYear?: number; deathYear?: number } {
  const match = /\((\d{4})\s*[–-]\s*(\d{4})?\)/.exec(description ?? "");
  return match ? { birthYear: Number(match[1]), deathYear: match[2] ? Number(match[2]) : undefined } : {};
}

/** « né le 28 mai 1974 », « mort le 2 juin 2009 » dans le texte de l'article. */
export function yearsFromExtract(extract?: string): { birthYear?: number; deathYear?: number } {
  // \b ne reconnaît pas « é » comme lettre : on borne avec des classes Unicode.
  const born = /(?<!\p{L})née?(?!\p{L})[^.()]{0,60}?(?<!\d)(\d{4})(?!\d)/u.exec(extract ?? "");
  const died = /(?<!\p{L})morte?(?!\p{L})[^.()]{0,60}?(?<!\d)(\d{4})(?!\d)/u.exec(extract ?? "");
  return { birthYear: born ? Number(born[1]) : undefined, deathYear: died ? Number(died[1]) : undefined };
}

/** Vrai si l'article Wikipédia décrit bien cet auteur (pas une page d'homonymie, un métier du livre, le bon nom de famille). */
export function isAuthorSummary(summary: WikipediaSummary | null | undefined, authorName: string): summary is WikipediaSummary {
  if (!summary || (summary.type && summary.type !== "standard")) return false;
  const lastName = normalizeText(authorName).split(" ").filter(Boolean).pop();
  if (!lastName) return false;
  const haystack = normalizeText(`${summary.title ?? ""} ${(summary.extract ?? "").slice(0, 300)}`);
  const trade = `${summary.description ?? ""} ${(summary.extract ?? "").slice(0, 250)}`;
  return haystack.includes(lastName) && BOOK_TRADE.test(trade);
}

const olBio = (bio: OpenLibraryAuthor["bio"]) => (typeof bio === "string" ? bio : bio?.value)?.trim() || undefined;

/** Assemble ce que l'on sait : Wikipédia d'abord, Open Library pour les dates et en secours. */
export function buildAuthorInfo(wikipedia: WikipediaSummary | null, openLibrary: OpenLibraryAuthor | null): AuthorInfo | null {
  const olYears = { birthYear: yearIn(openLibrary?.birth_date), deathYear: yearIn(openLibrary?.death_date) };
  if (wikipedia) {
    const fromDescription = yearsFromDescription(wikipedia.description);
    const fromExtract = yearsFromExtract(wikipedia.extract);
    const birthYear = fromDescription.birthYear ?? olYears.birthYear ?? fromExtract.birthYear;
    return {
      description: wikipedia.description?.replace(/\s*\(\d{4}\s*[–-]\s*(\d{4})?\)\s*$/, "").trim() || undefined,
      bio: wikipedia.extract?.trim() || undefined,
      photoUrl: wikipedia.thumbnail?.source,
      pageUrl: wikipedia.content_urls?.desktop?.page,
      birthYear,
      deathYear: fromDescription.birthYear ? fromDescription.deathYear : olYears.deathYear ?? fromExtract.deathYear,
      workCount: openLibrary?.work_count,
      source: "wikipedia"
    };
  }
  if (!openLibrary) return null;
  const bio = olBio(openLibrary.bio);
  const photo = openLibrary.photos?.find(id => id > 0);
  if (!bio && !photo && !olYears.birthYear) return null;
  return {
    bio,
    photoUrl: photo ? `https://covers.openlibrary.org/a/id/${photo}-M.jpg` : undefined,
    ...olYears,
    workCount: openLibrary.work_count,
    source: "open-library"
  };
}

/** « 1931–2009 », « né en 1974 », ou rien. */
export function formatLifespan(info: Pick<AuthorInfo, "birthYear" | "deathYear">): string {
  if (!info.birthYear) return "";
  return info.deathYear ? `${info.birthYear}–${info.deathYear}` : `né en ${info.birthYear}`;
}
