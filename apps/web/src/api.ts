/** A problem with one field, as the API reports it (for example a setting's value). */
export interface Issue {
  key: string;
  message: string;
}

/** An API error: the HTTP status, the API's message, and any field problems. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

/** Calls the Squirrelcade API. Errors become ApiError with the server's message. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let body: { error?: string; message?: string; issues?: Issue[] } = {};
    try {
      body = await res.json();
    } catch {
      // Not JSON.
    }
    if (res.status === 401 || res.status === 409) window.dispatchEvent(new Event('squirrelcade:session'));
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? res.statusText, body.issues ?? []);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** A message to show for any error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
