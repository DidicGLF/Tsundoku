/** Contrôle de la clé d'un ISBN-13 (EAN-13 commençant par 978 ou 979). */
export function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false;
  const sum = [...value].slice(0, 12).reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

/** L'ISBN lu sur un code-barres, ou undefined si ce n'est pas un livre (autre produit, lecture erronée). */
export function isbnFromBarcode(raw: string | undefined): string | undefined {
  const digits = raw?.replace(/\D/g, "");
  return digits && isValidIsbn13(digits) ? digits : undefined;
}
