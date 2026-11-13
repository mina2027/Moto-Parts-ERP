export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status = 500, code = 'ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null). */
  getToken?: () => string | null | Promise<string | null>;
  /** Called on 401 once; should refresh and return the new token or null to give up. */
  onUnauthorized?: () => Promise<string | null>;
  /** Extra headers sent with every request (e.g. X-Client). */
  headers?: Record<string, string>;
  /** `include` for cookie-based refresh on web; `omit` for Electron. */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Skip the 401 refresh dance (used by the refresh call itself). */
  noRetry?: boolean;
}

function buildQuery(q?: QueryParams): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class HttpClient {
  private opts: HttpClientOptions;
  private refreshing: Promise<string | null> | null = null;

  constructor(opts: HttpClientOptions) {
    this.opts = { credentials: 'include', ...opts, baseUrl: opts.baseUrl.replace(/\/+$/, '') };
  }

  setBaseUrl(url: string) {
    this.opts.baseUrl = url.replace(/\/+$/, '');
  }

  get baseUrl() {
    return this.opts.baseUrl;
  }

  async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(method, path, body, options);
    return data;
  }

  async requestWithHeaders<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<{ data: T; headers: Headers }> {
    const doFetch = async (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = { Accept: 'application/json', ...this.opts.headers, ...options.headers };
      if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
      const f = this.opts.fetchImpl ?? fetch;
      return f(`${this.opts.baseUrl}${path}${buildQuery(options.query)}`, {
        method,
        headers,
        credentials: this.opts.credentials,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal: options.signal,
      });
    };

    let token = (await this.opts.getToken?.()) ?? null;
    let res: Response;
    try {
      res = await doFetch(token);
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network error', 0, 'NETWORK');
    }

    if (res.status === 401 && !options.noRetry && this.opts.onUnauthorized) {
      this.refreshing ??= this.opts.onUnauthorized().finally(() => (this.refreshing = null));
      token = await this.refreshing;
      if (token) {
        try {
          res = await doFetch(token);
        } catch (e) {
          throw new ApiError(e instanceof Error ? e.message : 'Network error', 0, 'NETWORK');
        }
      }
    }

    if (res.status === 204) return { data: undefined as T, headers: res.headers };
    const text = await res.text();
    let data: unknown = null;
    let parsed = false;
    if (text) {
      try {
        data = JSON.parse(text);
        parsed = true;
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiError(err?.message ?? res.statusText ?? 'Request failed', res.status, err?.code ?? 'ERROR', err?.details);
    }
    // A 2xx that is not JSON means something other than the API answered (typically an SPA
    // fallback serving index.html because /api is not proxied). Surface it here, not as a
    // "x.map is not a function" deep inside a component.
    if (text && !parsed) {
      throw new ApiError(`Expected JSON from ${path} but got ${res.headers.get('content-type') ?? 'an unknown content type'} — is the API reachable at ${this.opts.baseUrl}?`, 502, 'INVALID_RESPONSE');
    }
    return { data: data as T, headers: res.headers };
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, undefined, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, body, options);
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, body, options);
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, body, options);
  }
  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, undefined, options);
  }
}
