import { apiClient } from './client';
import type { SubmitBrief } from '@cyanship/types';

export async function submitBrief(
    data: SubmitBrief,
): Promise<{ code: string }> {
    const { data: response } = await apiClient.post<{
        data: null;
        code: string;
    }>('/agency/brief', data);
    return { code: response.code };
}

export async function submitAuthenticatedBrief(
    data: SubmitBrief,
): Promise<{ code: string; aiBonusGranted: boolean }> {
    const { data: response } = await apiClient.post<{
        data: { aiBonusGranted: boolean };
        code: string;
    }>('/agency/brief/authenticated', data);
    return { code: response.code, aiBonusGranted: response.data.aiBonusGranted };
}
