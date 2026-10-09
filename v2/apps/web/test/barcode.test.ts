import { describe, expect, it } from "vitest";
import { isbnFromBarcode, isValidIsbn13 } from "../src/lib/barcode";

describe("isbnFromBarcode", () => {
  it("accepts a valid ISBN-13 barcode", () => {
    expect(isValidIsbn13("9782266033756")).toBe(true);
    expect(isbnFromBarcode("9782266033756")).toBe("9782266033756");
    expect(isbnFromBarcode(" 978-2-266-03375-6 ")).toBe("9782266033756");
  });
  it("rejects a bad check digit, other products and missing values", () => {
    expect(isbnFromBarcode("9782266033757")).toBeUndefined();
    expect(isbnFromBarcode("3017620422003")).toBeUndefined(); // EAN d'un produit courant
    expect(isbnFromBarcode("12345")).toBeUndefined();
    expect(isbnFromBarcode(undefined)).toBeUndefined();
  });
});
