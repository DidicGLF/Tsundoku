import type { SyncPage, SyncPayload, SyncTransport } from "./sync";

/** Erreur de synchronisation avec un message déjà lisible par l'utilisateur. */
export class SyncServerError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** Le serveur de synchronisation de Tsundoku, par HTTP. `baseUrl` : « https://mon-serveur.tailnet.ts.net ». */
export function createHttpTransport(
  baseUrl: string, key: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)
): SyncTransport & { ping(): Promise<void>; deleteAccount(): Promise<void>; offerPairing(id: string, payload: string): Promise<{ expiresInSeconds: number }> } {
  const root = baseUrl.trim().replace(/\/+$/, "");

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key.trim()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }
      });
    } catch {
      throw new SyncServerError("Serveur injoignable. Vérifie ta connexion Internet ; si elle est bonne, le serveur est peut-être arrêté ou son adresse a changé.");
    }
    if (response.status === 401) throw new SyncServerError("Clé de synchronisation refusée par le serveur.", 401);
    if (response.status === 429 || response.status === 503 || response.status === 413) {
      const detail = await response.json().then((body: { error?: string }) => body.error, () => undefined);
      throw new SyncServerError(detail ?? "Le serveur refuse cette requête.", response.status);
    }
    if (!response.ok) throw new SyncServerError(`Le serveur a répondu une erreur (${response.status}).`, response.status);
    return await response.json() as T;
  }

  return {
    async ping() { await call("/v1/ping"); },
    async deleteAccount() { await call("/v1/account", { method: "DELETE" }); },
    offerPairing(id: string, payload: string) { return call<{ expiresInSeconds: number }>(`/v1/pair/${id}`, { method: "PUT", body: JSON.stringify({ payload }) }); },
    async push(payload: SyncPayload) { await call("/v1/push", { method: "POST", body: JSON.stringify(payload) }); },
    pull(since: number, limit: number) { return call<SyncPage>(`/v1/pull?since=${since}&limit=${limit}`); }
  };
}

/**
 * Récupère le paquet chiffré d'un code de liaison (sans clé : c'est l'appareil qui rejoint).
 * Le code est à usage unique et dure quelques minutes.
 */
export async function claimPairing(baseUrl: string, id: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.trim().replace(/\/+$/, "")}/v1/pair/claim`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
    });
  } catch {
    throw new SyncServerError("Serveur injoignable. Vérifie ta connexion Internet ; si elle est bonne, le serveur est peut-être arrêté ou son adresse a changé.");
  }
  if (response.status === 404) throw new SyncServerError("Code inconnu ou expiré. Demande un nouveau code sur l'autre appareil.", 404);
  if (response.status === 429) throw new SyncServerError("Trop de tentatives, réessaie dans une minute.", 429);
  if (!response.ok) throw new SyncServerError(`Le serveur a répondu une erreur (${response.status}).`, response.status);
  return (await response.json() as { payload: string }).payload;
}
