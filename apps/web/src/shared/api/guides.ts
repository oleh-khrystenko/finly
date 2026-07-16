import {
    type AdminGuideListItem,
    type CommitGuideImageResponse,
    type Guide,
    type GuideImageUploadUrlResponse,
    type UpsertGuideRequest,
} from '@finly/types';

import { apiClient } from './client';

export async function adminListGuides(): Promise<AdminGuideListItem[]> {
    const { data } = await apiClient.get<{ data: AdminGuideListItem[] }>(
        '/admin/guides'
    );
    return data.data;
}

export async function adminGetGuide(id: string): Promise<Guide> {
    const { data } = await apiClient.get<{ data: Guide }>(
        `/admin/guides/${encodeURIComponent(id)}`
    );
    return data.data;
}

export async function createGuide(dto: UpsertGuideRequest): Promise<Guide> {
    const { data } = await apiClient.post<{ data: Guide }>(
        '/admin/guides',
        dto
    );
    return data.data;
}

export async function updateGuide(
    id: string,
    dto: UpsertGuideRequest
): Promise<Guide> {
    const { data } = await apiClient.patch<{ data: Guide }>(
        `/admin/guides/${encodeURIComponent(id)}`,
        dto
    );
    return data.data;
}

export async function publishGuide(id: string): Promise<Guide> {
    const { data } = await apiClient.post<{ data: Guide }>(
        `/admin/guides/${encodeURIComponent(id)}/publish`
    );
    return data.data;
}

export async function unpublishGuide(id: string): Promise<Guide> {
    const { data } = await apiClient.post<{ data: Guide }>(
        `/admin/guides/${encodeURIComponent(id)}/unpublish`
    );
    return data.data;
}

export async function deleteGuide(id: string): Promise<void> {
    await apiClient.delete(`/admin/guides/${encodeURIComponent(id)}`);
}

export async function requestGuideImageUploadUrl(): Promise<GuideImageUploadUrlResponse> {
    const { data } = await apiClient.post<{
        data: GuideImageUploadUrlResponse;
    }>('/admin/guides/images/upload-url');
    return data.data;
}

export async function commitGuideImage(
    fileKey: string
): Promise<CommitGuideImageResponse> {
    const { data } = await apiClient.post<{ data: CommitGuideImageResponse }>(
        '/admin/guides/images/commit',
        { fileKey }
    );
    return data.data;
}
