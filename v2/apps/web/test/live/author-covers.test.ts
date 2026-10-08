// @vitest-environment jsdom
// Mesure le taux de jaquettes sur de vraies bibliographies d'auteurs (réseau requis).
//   pnpm test:live           (sans clé)
//   GOOGLE_BOOKS_API_KEY=… pnpm test:live
import { beforeAll, it } from "vitest";
import { collapseToWorks } from "@tsundoku/book-sources";
import { getCredentialStore } from "../../src/services/credentials";
import { enrichSearchResults, searchCompleteAuthorBibliography } from "../../src/services/bookSearch";

beforeAll(async () => {
  if (process.env.GOOGLE_BOOKS_API_KEY) await getCredentialStore().setGoogleBooksApiKey(process.env.GOOGLE_BOOKS_API_KEY);
});

const AUTHORS = ["Frank Herbert", "Robin Hobb", "Amélie Nothomb"];

it("taux de jaquettes par bibliographie d'auteur", async () => {
  let total = 0, covered = 0;
  for (const name of AUTHORS) {
    const works = collapseToWorks(await searchCompleteAuthorBibliography(name, "all", "fr", true));
    const start = performance.now();
    const steps: string[] = [];
    const enriched = await enrichSearchResults(works, "fr", partial => steps.push(`${((performance.now() - start) / 1000).toFixed(0)}s:${partial.filter(b => b.coverUrl).length}`));
    const n = enriched.filter(b => b.coverUrl).length;
    total += works.length; covered += n;
    console.log(`${name.padEnd(16)} ${n}/${works.length} (${Math.round(100 * n / works.length)}%) en ${((performance.now() - start) / 1000).toFixed(0)}s | progression ${steps.filter((_, i) => i % 4 === 0).join(" ")}`);
  }
  console.log(`TOTAL ${covered}/${total} (${Math.round(100 * covered / total)}%) — clé: ${process.env.GOOGLE_BOOKS_API_KEY ? "oui" : "non"}`);
}, 900000);
