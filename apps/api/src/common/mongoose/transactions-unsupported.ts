/**
 * Sprint 4 §SP-5 — детектор `withTransaction`-incompatibility error-у з Mongo
 * driver-у. Standalone mongod кидає message що містить
 * "Transaction numbers are only allowed on a replica set member or mongos"
 * (codeName: `IllegalOperation`, code: 20). Перевірка на message — robust
 * проти версій Mongo (codes можуть дрейфнути).
 *
 * **Spільний helper.** Раніше жив локально в `BusinessesService`. Тепер
 * `InvoicesService.create` теж використовує транзакцію (orphan-prevention,
 * Sprint 4 review fix), тож потрібен спільний primitive — без дублювання
 * regex-у.
 */
export function isTransactionsUnsupportedError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return /transaction.*replica set|replica set.*transaction/i.test(
        err.message
    );
}
