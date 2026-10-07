export interface CanonicalAuthorName {
  /** Name shown to the user. */
  display: string;
  /** Stable-ish textual identity used to merge API variants. */
  identity: string;
  /** Name used for alphabetical ordering (surname first when known). */
  sort: string;
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function identityText(value: string): string {
  return stripDiacritics(value)
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Turns the author labels returned by catalog APIs into one canonical form.
 *
 * BnF/Dublin Core commonly returns authority labels such as:
 *   "Eddings, David (1931-2009). Auteur du texte"
 * while Open Library / Google Books generally return:
 *   "David Eddings"
 *
 * We preserve the API-provided name parts and only remove authority metadata
 * (dates/roles) and convert the catalogue form "Surname, Given" for display.
 */
export function canonicalAuthorName(value: string): CanonicalAuthorName {
  const original = value.trim();
  if (!original) return { display: "Auteur inconnu", identity: "", sort: "zzzz auteur inconnu" };

  // Authority/catalogue metadata is not part of the person's name.
  let name = original
    .replace(/\s*\([^)]*(?:\d{4}|\?)[^)]*\)\s*/g, " ")
    .replace(/\s*\.\s*(?:auteur(?:e)?(?:\s+du\s+texte)?|traducteur(?:rice)?|illustrateur(?:rice)?|préfacier|préfacière|éditeur(?:rice)?\s+scientifique|collaborateur(?:rice)?|directeur(?:rice)?\s+de\s+publication)\b.*$/iu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:,]\s*$/, "")
    .trim();

  if (!name) name = original;

  // BnF authority labels use the cataloguing convention "Surname, Given".
  const comma = name.indexOf(",");
  if (comma > 0) {
    const surname = name.slice(0, comma).trim();
    const given = name.slice(comma + 1).trim();
    if (surname && given) {
      const display = `${given} ${surname}`.replace(/\s+/g, " ").trim();
      return {
        display,
        identity: identityText(display),
        sort: `${identityText(surname)} ${identityText(given)}`.trim()
      };
    }
  }

  const display = name;
  const words = display.split(/\s+/).filter(Boolean);
  const surname = words.at(-1) ?? display;
  return {
    display,
    identity: identityText(display),
    sort: `${identityText(surname)} ${identityText(display)}`.trim()
  };
}

export function canonicalAuthorDisplay(value: string): string {
  return canonicalAuthorName(value).display;
}

export function canonicalAuthorIdentity(value: string): string {
  return canonicalAuthorName(value).identity;
}

export function canonicalAuthorSort(value: string): string {
  return canonicalAuthorName(value).sort;
}
