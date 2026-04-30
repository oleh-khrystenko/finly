import { apiClient } from './client';
import type {
    ExecutionTransactionItem,
    PaginatedTransactions,
    SpendableAction,
} from '@finly/types';

export async function spendExecutions(
    action: SpendableAction,
): Promise<{ balance: number; transaction: ExecutionTransactionItem }> {
    const { data } = await apiClient.post<{
        data: { balance: number; transaction: ExecutionTransactionItem };
    }>('/users/me/executions/spend', { action });
    return data.data;
}

export async function getExecutionTransactions(
    limit: number = 10,
    before?: string,
): Promise<PaginatedTransactions> {
    const { data } = await apiClient.get<{ data: PaginatedTransactions }>(
        '/users/me/executions/transactions',
        { params: { limit, ...(before && { before }) } },
    );
    return data.data;
}
