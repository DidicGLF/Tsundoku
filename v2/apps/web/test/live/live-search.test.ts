// @vitest-environment jsdom
// Test manuel contre les vrais services : lancé à la main, jamais dans la suite normale.
import { beforeAll, it } from "vitest";
import { getCredentialStore } from "../../src/services/credentials";
import { enrichSearchResults, searchBooks, searchCompleteAuthorBibliography } from "../../src/services/bookSearch";

// La clé Google Books n'est jamais écrite dans le dépôt : on la lit dans l'environnement.
//   GOOGLE_BOOKS_API_KEY=… pnpm test:live
beforeAll(async () => {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) await getCredentialStore().setGoogleBooksApiKey(key);
  console.log(`clé Google Books : ${key ? "configurée" : "absente"}`);
});

const t0 = () => performance.now();
const since = (start: number) => `${((performance.now() - start) / 1000).toFixed(1)}s`;

it("recherche générale progressive + couvertures", async () => {
  const start = t0();
  const found = await searchBooks("dune herbert", "all", "fr", 0, "all", partial => console.log(`  +${since(start)} → ${partial.length} résultats`));
  console.log(`recherche terminée en ${since(start)} : ${found.length} résultats, ${found.filter(b => b.coverUrl).length} avec jaquette`);
  const e0 = t0();
  const enriched = await enrichSearchResults(found, "fr", partial => console.log(`  +${since(e0)} jaquettes: ${partial.filter(b => b.coverUrl).length}/${partial.length}`));
  console.log(`enrichissement terminé en ${since(e0)} : ${enriched.filter(b => b.coverUrl).length}/${enriched.length} avec jaquette`);
}, 120000);

it("bibliographie auteur progressive", async () => {
  const start = t0();
  const found = await searchCompleteAuthorBibliography("Frank Herbert", "all", "fr", true, partial => console.log(`  +${since(start)} → ${partial.length} notices`));
  console.log(`auteur terminé en ${since(start)} : ${found.length} notices`);
}, 180000);
