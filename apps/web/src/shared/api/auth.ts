import {
    CURRENT_TERMS_VERSION,
    type AuthResponse,
    type CheckEmailResponse,
    type MagicLinkPurpose,
    type UpdateProfileDto,
    type UserProfile,
    type VerifyMagicLinkResponse,
} from '@neatslip/types';

import { getTimezone } from '@/shared/lib';

import { apiClient, setAccessToken } from './client';

export async function checkEmail(email: string): Promise<CheckEmailResponse> {
    const { data } = await apiClient.post<{ data: CheckEmailResponse }>(
        '/auth/check-email',
        { email }
    );
    return data.data;
}

export async function loginWithPassword(
    email: string,
    password: string
): Promise<AuthResponse> {
    const { data } = await apiClient.post<{ data: AuthResponse }>(
        '/auth/login/password',
        { email, password, termsVersion: CURRENT_TERMS_VERSION }
    );

    setAccessToken(data.data.accessToken);
    return data.data;
}

export async function sendMagicLink(
    email: string,
    lang?: string,
    purpose?: MagicLinkPurpose,
    redirectTo?: string
): Promise<void> {
    await apiClient.post('/auth/magic-link/send', { email, lang, purpose, redirectTo });
}

export async function setPassword(password: string): Promise<void> {
    await apiClient.post('/auth/password/set', { password });
}

export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<{ accessToken: string }> {
    const { data } = await apiClient.post<{
        data: { accessToken: string };
    }>('/auth/password/change', {
        currentPassword,
        newPassword,
    });

    setAccessToken(data.data.accessToken);
    return data.data;
}

export async function resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string
): Promise<void> {
    await apiClient.post('/auth/password/reset', {
        token,
        newPassword,
        confirmPassword,
    });
}

export async function verifyPassword(
    password: string
): Promise<{ isValid: boolean }> {
    const { data } = await apiClient.post<{
        data: { isValid: boolean };
    }>('/auth/password/verify', { password });
    return data.data;
}

export async function updateProfile(
    dto: UpdateProfileDto
): Promise<UserProfile> {
    const { data } = await apiClient.patch<{ data: UserProfile }>(
        '/users/me',
        dto
    );
    return data.data;
}

export async function deleteAccount(): Promise<{
    requiresPassword?: boolean;
    requiresMagicLink?: boolean;
}> {
    const { data } = await apiClient.post<{
        data: {
            requiresPassword?: boolean;
            requiresMagicLink?: boolean;
        };
    }>('/users/account/delete');
    return data.data;
}

export async function confirmDeleteAccount(
    password: string
): Promise<void> {
    await apiClient.post('/users/account/delete/confirm', { password });
}

export async function restoreAccount(): Promise<void> {
    await apiClient.post('/users/account/restore');
}

export async function verifyMagicLink(
    token: string
): Promise<VerifyMagicLinkResponse> {
    const { data } = await apiClient.post<{ data: VerifyMagicLinkResponse }>(
        '/auth/magic-link/verify',
        { token }
    );

    if ('accessToken' in data.data) {
        setAccessToken(data.data.accessToken);
    }
    return data.data;
}

export async function refreshToken(): Promise<string> {
    const { data } = await apiClient.post<{
        data: { accessToken: string };
    }>('/auth/refresh', { timezone: getTimezone() });

    setAccessToken(data.data.accessToken);
    return data.data.accessToken;
}

export async function logout(): Promise<void> {
    await apiClient.post('/auth/logout');
    setAccessToken(null);
}

export async function getMe(): Promise<UserProfile> {
    const { data } = await apiClient.get<{ data: UserProfile }>('/users/me');
    return data.data;
}

export async function updatePreferredLang(lang: string): Promise<void> {
    await apiClient.patch('/users/me/lang', { lang });
}

export async function acceptTerms(): Promise<void> {
    await apiClient.post('/users/me/accept-terms', {
        termsVersion: CURRENT_TERMS_VERSION,
    });
}
