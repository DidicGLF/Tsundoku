import type { SyncPage, SyncPayload, SyncTransport } from "./sync";

/** Erreur de synchronisation avec un message déjà lisible par l'utilisateur. */
export class SyncServerError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

/** Le serveur de synchronisation de Tsundoku, par HTTP. `baseUrl` : « https://mon-serveur.tailnet.ts.net ». */
export function createHttpTransport(
  baseUrl: string, token: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)
): SyncTransport & { ping(): Promise<void> } {
  const root = baseUrl.trim().replace(/\/+$/, "");

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token.trim()}`, ...(init.body ? { "Content-Type": "application/json" } : {}) }
      });
    } catch {
      throw new SyncServerError("Serveur injoignable. Vérifie l'adresse, ta connexion et que Tailscale est actif.");
    }
    if (response.status === 401) throw new SyncServerError("Jeton refusé par le serveur.", 401);
    if (!response.ok) throw new SyncServerError(`Le serveur a répondu une erreur (${response.status}).`, response.status);
    return await response.json() as T;
  }

  return {
    async ping() { await call("/v1/ping"); },
    async push(payload: SyncPayload) { await call("/v1/push", { method: "POST", body: JSON.stringify(payload) }); },
    pull(since: number, limit: number) { return call<SyncPage>(`/v1/pull?since=${since}&limit=${limit}`); }
  };
}
