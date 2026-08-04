import type {
    CreatePayerDto,
    PayerSource,
    PayerView,
    UpdatePayerDto,
} from '@finly/types';

import { apiClient } from './client';

/**
 * Sprint 30 — список платників користувача. Кабінетні маршрути під сесією;
 * викликаються і з публічної податкової сторінки (спільна сесія, той самий
 * origin), тому окремого публічного клієнта тут не існує — це персональні дані.
 */

export async function listPayers(): Promise<PayerView[]> {
    const { data } = await apiClient.get<{ data: PayerView[] }>('/payers');
    return data.data;
}

export async function createPayer(dto: CreatePayerDto): Promise<PayerView> {
    const { data } = await apiClient.post<{ data: PayerView }>('/payers', dto);
    return data.data;
}

export async function updatePayer(
    id: string,
    dto: UpdatePayerDto
): Promise<PayerView> {
    const { data } = await apiClient.patch<{ data: PayerView }>(
        `/payers/${encodeURIComponent(id)}`,
        dto
    );
    return data.data;
}

export async function deletePayer(id: string): Promise<void> {
    await apiClient.delete(`/payers/${encodeURIComponent(id)}`);
}

/**
 * Отримувачі-фізособи користувача як джерела підстановки. Окремий шлях, а не
 * `/businesses/me`: кабінетний список ділиться за режимом бухгалтера і тягне
 * повні документи, а платіжній сторінці потрібні всі доступні людині записи і
 * рівно три поля.
 */
export async function listPayerSources(): Promise<PayerSource[]> {
    const { data } = await apiClient.get<{ data: PayerSource[] }>(
        '/payer-sources'
    );
    return data.data;
}
