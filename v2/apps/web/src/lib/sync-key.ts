/** Clé de synchronisation : 32 octets aléatoires en base64url (43 caractères). Elle identifie la bibliothèque sur le serveur. */
export function generateSyncKey(random: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Une clé saisie ou scannée : les espaces autour sont ignorés ; au moins 32 caractères sûrs. */
export function parseSyncKey(value: string): string | undefined {
  const key = value.trim();
  return /^[A-Za-z0-9_-]{32,200}$/.test(key) ? key : undefined;
}
