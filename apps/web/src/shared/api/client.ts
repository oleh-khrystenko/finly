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
