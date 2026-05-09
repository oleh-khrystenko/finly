import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { ENV } from '@/shared/config';
import { authEvents, getTimezone } from '@/shared/lib';

// In-memory token storage (more secure than localStorage)
let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
    accessToken = token;
};

export const apiClient = axios.create({
    baseURL: ENV.NEXT_PUBLIC_API_URL,
    withCredentials: true,
});

export class PublicApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string
    ) {
        super(`Public API request failed: ${status} ${statusText}`);
        this.name = 'PublicApiError';
    }
}

/**
 * Browser-side fetch для public-endpoint-ів (`/businesses/public/*`).
 *
 * **Чому native `fetch` з `credentials: 'omit'`, а не axios з
 * `withCredentials: false`** (review fix Sprint 4):
 *
 * Prod-like setup тримає API і web на одному origin: `NEXT_PUBLIC_API_URL=
 * /api`, `next.config.ts` rewrite-ить `/api/*` → backend. Browser бачить
 * запити як same-origin. Для XHR (axios) `withCredentials` керує тільки
 * cross-origin поведінкою:
 *   - `withCredentials: false` (default): same-origin requests **все одно
 *     надсилають cookies**. Cross-origin — ні.
 *   - `withCredentials: true`: всі запити з cookies.
 * Тобто axios `withCredentials: false` для same-origin /api **не блокує**
 * `bid_refresh`-cookie. Це фундаментальне обмеження XHR API — еквівалент
 * `credentials: 'omit'` у XHR відсутній.
 *
 * Native `fetch` має `credentials: 'omit'`, який гарантовано не надсилає
 * cookies незалежно від origin-а. Це єдиний браузерний механізм, що дійсно
 * вирізає cookies на same-origin.
 *
 * **Що цей helper гарантує** для public hop-у:
 *   - Жодних cookies (`credentials: 'omit'`).
 *   - Жодного `Authorization`-header-а (request-interceptor cabinet-у не
 *     торкає цей запит — окрема функція без axios).
 *   - Жодного refresh-flow на 401 (refresh-interceptor seman-tично
 *     безглуздий для public endpoint-ів — вони не повертають 401).
 *   - Public response identical для anonymous user-а на pay.finly.com.ua і
 *     для authed user-а у кабінеті, що робить preview-toggle (Sprint 3
 *     §3.8 + Sprint 4 §4.6).
 */
export async function publicFetchJson<T>(path: string): Promise<T> {
    const baseURL = ENV.NEXT_PUBLIC_API_URL;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseURL}${normalizedPath}`;
    const res = await fetch(url, {
        credentials: 'omit',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        throw new PublicApiError(res.status, res.statusText);
    }
    return (await res.json()) as T;
}

/**
 * Sprint 8 §8.3 — POST-варіант `publicFetchJson`. Той самий контракт безпеки
 * (`credentials: 'omit'`, без `Authorization`-header, без refresh-flow), плюс
 * `Content-Type: application/json` та `JSON.stringify(body)`.
 *
 * Використовується anon `POST /api/qr/preview` (Sprint 8 §8.1) — публічний
 * QR-preview-ендпоінт без auth. axios `apiClient` з `withCredentials: true`
 * + Bearer-interceptor суперечив би заявленому контракту "без auth, без
 * cookie" (interceptor підставив би Bearer, якщо anon-користувач залогінений
 * у тій же вкладці на cabinet host — leak ідентичності у anon-flow).
 *
 * Non-2xx → `PublicApiError` (reuse того самого error-class). Парсить
 * успішний body як JSON; виклик-сторона валідує shape через Zod-схему
 * (defense-in-depth проти silent backend-shape-drift).
 */
export async function publicPostJson<TBody, TRes>(
    path: string,
    body: TBody
): Promise<TRes> {
    const baseURL = ENV.NEXT_PUBLIC_API_URL;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseURL}${normalizedPath}`;
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new PublicApiError(res.status, res.statusText);
    }
    return (await res.json()) as TRes;
}

// Request interceptor: attach Bearer token
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

// Response interceptor: auto-refresh on 401
let refreshPromise: Promise<string | null> | null = null;

interface RetryableRequest extends InternalAxiosRequestConfig {
    _retry?: boolean;
}

apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as RetryableRequest | undefined;

        const url = originalRequest?.url ?? '';
        const isAuthPasswordUrl =
            url.includes('/auth/password/') ||
            url.includes('/auth/login/password') ||
            url.includes('/auth/refresh') ||
            url.includes('/auth/logout');

        if (
            !originalRequest ||
            error.response?.status !== 401 ||
            originalRequest._retry ||
            isAuthPasswordUrl
        ) {
            return Promise.reject(error);
        }

        originalRequest._retry = true;

        // Deduplicate concurrent refresh requests
        if (!refreshPromise) {
            refreshPromise = axios
                .post<{ data: { accessToken: string } }>(
                    `${ENV.NEXT_PUBLIC_API_URL}/auth/refresh`,
                    { timezone: getTimezone() },
                    { withCredentials: true }
                )
                .then((res) => {
                    const newToken = res.data.data.accessToken;
                    setAccessToken(newToken);
                    return newToken;
                })
                .catch(() => {
                    setAccessToken(null);

                    // Notify domain layers that the session is gone.
                    // The auth store (entities/user) subscribes to this
                    // event and owns the corresponding state transition.
                    // Publishing an event keeps `shared/api` decoupled
                    // from higher FSD layers (entities, features).
                    authEvents.emit('session-lost');

                    return null;
                })
                .finally(() => {
                    refreshPromise = null;
                });
        }

        const newToken = await refreshPromise;

        if (!newToken) {
            return Promise.reject(error);
        }

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
    }
);
