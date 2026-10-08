// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BnfClient, collectionFromNotes, mapRecord, pageCountFromFormat, summaryFromNotes } from "../src/bnf/BnfClient";
import { collectionBase, publisherName } from "../src/matching";

const record = (title: string, collection: string, publisher = "Pocket (Paris)") => `
<srw:record><srw:recordData><oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb${title.length}</dc:identifier>
  <dc:title>${title} / David Eddings</dc:title>
  <dc:creator>Eddings, David (1931-2009). Auteur du texte</dc:creator>
  <dc:publisher>${publisher}</dc:publisher>
  <dc:date>1995</dc:date>
  <dc:description>${collection}</dc:description>
  <dc:identifier>ISBN 2266066056</dc:identifier>
  <dc:format>410 p. : couv. ill. ; 18 cm</dc:format>
  <dc:language>fre</dc:language>
</oai_dc:dc></srw:recordData></srw:record>`;
const feed = (...records: string[]) =>
  `<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:numberOfRecords>${records.length}</srw:numberOfRecords><srw:records>${records.join("")}</srw:records></srw:searchRetrieveResponse>`;

afterEach(() => vi.unstubAllGlobals());

describe("BnF notes", () => {
  it("reads the collection, the page count and no longer takes catalogue notes for a summary", () => {
    const xml = new DOMParser().parseFromString(feed(record("Le trône de diamant", "Collection : Pocket. Science-fiction")), "application/xml");
    const mapped = mapRecord(xml.getElementsByTagNameNS("*", "record")[0])!;
    expect(mapped).toMatchObject({ publisher: "Pocket (Paris)", collection: "Pocket. Science-fiction", pageCount: 410, isbn10: "2266066056", authors: ["David Eddings"] });
    expect(mapped.description).toBeUndefined();
  });
  it("picks the most specific collection and recognises real summaries", () => {
    expect(collectionFromNotes(["Collection : Pocket", "Collection : Pocket. Science-fiction : fantasy"])).toBe("Pocket. Science-fiction : fantasy");
    expect(collectionFromNotes(["Code à barres commercial : EAN 9782811207984"])).toBeUndefined();
    expect(summaryFromNotes(["Code à barres commercial : EAN 9782811207984", "Collection : Pocket"])).toBeUndefined();
    expect(summaryFromNotes(["Résumé : Une histoire de dragons."])).toBe("Une histoire de dragons.");
    expect(pageCountFromFormat(["1 vol. (XII-410 p.) ; 18 cm"])).toBe(410);
    expect(pageCountFromFormat(["1 disque"])).toBeUndefined();
  });
  it("normalises publisher and collection names", () => {
    expect(publisherName("Pocket (Paris)")).toBe("Pocket");
    expect(publisherName(undefined)).toBeUndefined();
    expect(collectionBase("Pocket. Science-fiction : fantasy")).toBe("Pocket. Science-fiction");
  });
});

describe("BnfClient.searchSimilar", () => {
  it("searches the collection words and keeps only notices of that collection", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(decodeURIComponent(String(url).replace(/\+/g, " ")));
      return new Response(feed(
        record("Le trône de diamant", "Collection : Pocket. Science-fiction"),
        record("La reine des sortilèges", "Collection : Pocket. Science-fiction : fantasy"),
        record("Autre collection", "Collection : Rendez-vous ailleurs")
      ), { status: 200 });
    });
    const page = await new BnfClient().searchSimilar({ collection: "Pocket. Science-fiction : fantasy", author: "David Eddings" });
    expect(urls[0]).toContain('bib.anywhere all "Pocket Science-fiction"');
    expect(urls[0]).toContain('bib.author all "David Eddings"');
    expect(page.rawCount).toBe(3);
    expect(page.books.map(book => book.title)).toEqual(["Le trône de diamant / David Eddings", "La reine des sortilèges / David Eddings"]);
  });
  it("uses the publisher index when no collection is given", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { urls.push(decodeURIComponent(String(url).replace(/\+/g, " "))); return new Response(feed(record("X", "Collection : Pocket")), { status: 200 }); });
    const page = await new BnfClient().searchSimilar({ publisher: "Pocket", author: "David Eddings" });
    expect(urls[0]).toContain('bib.publisher all "Pocket" and bib.author all "David Eddings"');
    expect(page.books).toHaveLength(1);
    expect(await new BnfClient().searchSimilar({})).toEqual({ books: [], rawCount: 0 });
  });
});
