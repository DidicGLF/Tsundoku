export function isProbablyGoogleBooksApiKey(value: string): boolean {
  const key = value.trim();
  return key.length >= 10 && !/\s/.test(key);
}
