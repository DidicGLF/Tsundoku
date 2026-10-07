import type { BookSearchResult } from "@tsundoku/book-sources";

export interface SeriesInfo {
  seriesName?: string;
  seriesVolume?: number;
}

function cleanSeriesName(value?: string): string | undefined {
  const name = value
    ?.replace(/^\s*[\[(]+|[\])]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,:;\-–—]\s*$/g, "")
    .trim();
  return name || undefined;
}

function volumeNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Complète série/tome seulement à partir d'indices explicites. */
export function detectSeriesInfo(book: BookSearchResult): SeriesInfo {
  let seriesName = cleanSeriesName(book.seriesName);
  let seriesVolume = book.seriesVolume;
  const title = book.title.trim();

  // Certaines API exposent une série déjà formatée, par exemple
  // "The Belgariad -- bk.1". On sépare alors le nom et le numéro de tome.
  if (seriesName && seriesVolume == null) {
    const explicitSeries = seriesName.match(/^(.*?)\s*(?:--|[-–—])\s*(?:bk\.?|book|vol\.?|volume|tome|t\.?|no\.?|#)?\s*(\d+(?:[.,]\d+)?)\s*$/i);
    if (explicitSeries) {
      seriesName = cleanSeriesName(explicitSeries[1]);
      seriesVolume = volumeNumber(explicitSeries[2]);
    }
  }

  // Ex. "Le Pion blanc des présages (La Belgariade, #1)".
  const parenthetical = title.match(/[\[(]\s*([^\])]+?)\s*[,;\-–—]\s*(?:tome|volume|vol\.?|livre|book|#)\s*(\d+(?:[.,]\d+)?)\s*[\])]/i);
  if (parenthetical) {
    seriesName ??= cleanSeriesName(parenthetical[1]);
    seriesVolume ??= volumeNumber(parenthetical[2]);
  }

  // Ex. "La Belgariade, tome 3 : Le Gambit du magicien".
  const prefixed = title.match(/^(.+?)\s*[,;:\-–—]\s*(?:tome|volume|vol\.?|livre|book)\s*(\d+(?:[.,]\d+)?)\b/i)
    ?? title.match(/^(.+?)\s+(?:tome|volume|vol\.?|livre|book)\s*(\d+(?:[.,]\d+)?)\b/i);
  if (prefixed) {
    seriesName ??= cleanSeriesName(prefixed[1]);
    seriesVolume ??= volumeNumber(prefixed[2]);
  }

  if (seriesName && seriesVolume == null) {
    const explicitVolume = title.match(/\b(?:tome|volume|vol\.?|livre|book)\s*(\d+(?:[.,]\d+)?)\b/i)
      ?? title.match(/(?:^|[\s,(])#\s*(\d+(?:[.,]\d+)?)(?:\b|[\s,)])/i);
    seriesVolume = volumeNumber(explicitVolume?.[1]);
  }

  return { seriesName, seriesVolume };
}

export function withDetectedSeries(book: BookSearchResult): BookSearchResult {
  return { ...book, ...detectSeriesInfo(book) };
}
