/*
 * Code de liaison : 8 caractères faciles à taper (sans 0/O/1/I/L), valables quelques minutes, qui servent à chiffrer
 * la clé de synchronisation avant de la confier au serveur. Le serveur ne reçoit que l'identifiant dérivé du code et le
 * paquet chiffré : il ne connaît ni le code ni la clé. Le nouvel appareil refait la même dérivation pour retrouver les deux.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const ITERATIONS = 150_000;
const SALT = new TextEncoder().encode("tsundoku-pairing-v1");

const toHex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

/** Un code au hasard, sans biais (les tirages hors de la plage sont refaits). */
export function generatePairingCode(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const limit = 256 - (256 % ALPHABET.length);
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of random(new Uint8Array(16))) {
      if (byte < limit && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

/** « K7M4QX2R » → « K7M4-QX2R ». */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Ce que l'utilisateur a tapé (minuscules, tiret, espaces) → le code, ou undefined si ce n'en est pas un. */
export function normalizePairingCode(input: string): string | undefined {
  const code = [...input.toUpperCase()].filter(char => ALPHABET.includes(char)).join("");
  return code.length === CODE_LENGTH && input.replace(/[\s-]/g, "").length === CODE_LENGTH ? code : undefined;
}

async function derive(code: string): Promise<{ id: string; key: CryptoKey }> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: SALT, iterations: ITERATIONS }, material, 512));
  const key = await crypto.subtle.importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id: toHex(bits.slice(0, 32)), key };
}

/** Chiffre la clé de synchronisation avec le code : renvoie l'identifiant à déposer et le paquet chiffré. */
export async function sealKey(code: string, syncKey: string): Promise<{ id: string; payload: string }> {
  const { id, key } = await derive(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(syncKey)));
  return { id, payload: toBase64(new Uint8Array([...iv, ...encrypted])) };
}

/** L'identifiant à demander au serveur pour ce code. */
export async function pairingIdOf(code: string): Promise<string> {
  return (await derive(code)).id;
}

/** Déchiffre le paquet reçu avec le code : la clé de synchronisation. */
export async function openKey(code: string, payload: string): Promise<string> {
  const { key } = await derive(code);
  const bytes = fromBase64(payload);
  try {
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return new TextDecoder().decode(clear);
  } catch {
    throw new Error("Ce code ne correspond pas. Vérifie-le ou demande-en un nouveau.");
  }
}
