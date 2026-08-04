'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    RESPONSE_CODE,
    type AccountWithCounts,
    type Business,
} from '@finly/types';

import { adminGetPayee, extractApiErrorCode } from '@/shared/api';

/**
 * `not-found` і `error` розділені: тимчасовий збій (мережа, 429, 500) не можна
 * показувати як ствердне «запису не існує» — це підштовхує адміна створити дубль.
 */
export type AdminPayeeState =
    | { phase: 'loading' }
    | { phase: 'not-found' }
    | { phase: 'error' }
    | { phase: 'ready'; business: Business; accounts: AccountWithCounts[] };

/**
 * Sprint 29 — завантаження системного отримувача разом з його реквізитами.
 * Спільне для всіх трьох адмін-сторінок запису (перегляд, редагування
 * отримувача, редагування реквізитів): окремого GET на одні реквізити немає,
 * адмін-детальний ендпоінт віддає піддерево одним запитом.
 *
 * Тримаємо в одному місці саме тому, що інакше кожна сторінка носила б власну
 * копію стан-машини і розгалуження `SYSTEM_PAYEE_NOT_FOUND`, і зміна поведінки
 * завантаження вимагала б синхронної правки у трьох файлах.
 */
export function useAdminPayee(slug: string): {
    state: AdminPayeeState;
    reload: () => Promise<void>;
} {
    const [state, setState] = useState<AdminPayeeState>({ phase: 'loading' });

    // Guard на `reload`: він викликається після мутації, тобто вже поза
    // життєвим циклом первинного effect-а, і відповідь може прийти після
    // розмонтування сторінки.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        adminGetPayee(slug)
            .then(({ business, accounts }) => {
                if (active) setState({ phase: 'ready', business, accounts });
            })
            .catch((err) => {
                if (!active) return;
                setState({
                    phase:
                        extractApiErrorCode(err) ===
                        RESPONSE_CODE.SYSTEM_PAYEE_NOT_FOUND
                            ? 'not-found'
                            : 'error',
                });
            });
        return () => {
            active = false;
        };
    }, [slug]);

    /**
     * Перечитування після мутації. Навмисно НЕ ковтає помилку і не переводить
     * екран у фазу `error`: мутація вже вдалася і показала успішний тост, тож
     * зрив перечитування має лишити наявні дані на екрані, а не стерти
     * сторінку. Як показати збій, вирішує викликач.
     */
    const reload = useCallback(async () => {
        const fresh = await adminGetPayee(slug);
        if (mountedRef.current) {
            setState({ phase: 'ready', ...fresh });
        }
    }, [slug]);

    return { state, reload };
}
