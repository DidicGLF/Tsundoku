export interface RequestOptions {
  /** Whole request, body included. A stalled mobile connection must not block a search forever. */
  timeoutMs?: number;
  /** Extra attempts after a network error, a timeout or a transient server status. */
  retries?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 12000;
// 500 is deliberately absent: the BnF answers 500 for a page past the last record.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

async function request<T>(url: string, read: (response: Response) => Promise<T>, options: RequestOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, headers } = options;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.ok) return await read(response);
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
        throw new Error(`HTTP ${response.status} while requesting ${hostOf(url)}`);
      }
    } catch (error) {
      const retryable = !(error instanceof Error && error.message.startsWith("HTTP "));
      if (!retryable || attempt >= retries) {
        throw controller.signal.aborted ? new Error(`Délai dépassé en interrogeant ${hostOf(url)}`) : error;
      }
    } finally {
      clearTimeout(timer);
    }
    await sleep(400 * (attempt + 1));
  }
}

export function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  return request(url, response => response.json() as Promise<T>, options);
}

export function getText(url: string, options: RequestOptions = {}): Promise<string> {
  return request(url, response => response.text(), options);
}
