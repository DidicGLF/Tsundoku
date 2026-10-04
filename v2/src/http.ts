export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while requesting ${new URL(url).hostname}`);
  }
  return response.json() as Promise<T>;
}
