import { describe, expect, it } from "vitest";
import { canonicalAuthorDisplay, canonicalAuthorIdentity, canonicalAuthorName, canonicalAuthorSort } from "../src/authors";

describe("canonicalAuthorName", () => {
  it("reverses BnF 'Surname, Given' labels and strips dates and roles", () => {
    expect(canonicalAuthorDisplay("Eddings, David (1931-2009). Auteur du texte")).toBe("David Eddings");
  });
  it("gives the same identity for BnF and Open Library spellings", () => {
    expect(canonicalAuthorIdentity("Eddings, David (1931-2009). Auteur du texte")).toBe(canonicalAuthorIdentity("David Eddings"));
  });
  it("ignores accents and case in the identity", () => {
    expect(canonicalAuthorIdentity("Hélène Carrère d'Encausse")).toBe(canonicalAuthorIdentity("HELENE CARRERE D ENCAUSSE"));
  });
  it("sorts by surname first", () => {
    expect(canonicalAuthorSort("David Eddings") < canonicalAuthorSort("Frank Herbert")).toBe(true);
  });
  it("handles empty input", () => {
    expect(canonicalAuthorName("  ")).toMatchObject({ display: "Auteur inconnu", identity: "" });
  });
});
