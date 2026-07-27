'use client';

import { useEffect, useState } from 'react';
import { RESPONSE_CODE, type Business } from '@finly/types';

import { adminGetPayee, extractApiErrorCode } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

import { AdminPayeeForm } from './AdminPayeeForm';

// `not-found` і `error` розділені: тимчасовий збій (мережа, 429, 500) не можна
// показувати як ствердне «запису не існує».
type LoadState =
    | { phase: 'loading' }
    | { phase: 'not-found' }
    | { phase: 'error' }
    | { phase: 'ready'; business: Business };

/**
 * Sprint 29 — завантажувач редагування системного отримувача: тягне поточні дані
 * (адмін-fetch під auth) і віддає їх у `AdminPayeeForm` як `existing`. Дзеркалить
 * патерн `AdminPayeeDetail` (client-fetch + spinner/error), щоб сторінка лишалась
 * тонкою.
 */
export function AdminPayeeEdit({ slug }: { slug: string }) {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });

    useEffect(() => {
        let active = true;
        adminGetPayee(slug)
            .then(({ business }) => {
                if (active) setState({ phase: 'ready', business });
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

    if (state.phase === 'loading') {
        return (
            <UiPageContainer narrow>
                <div className="flex flex-1 items-center justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }
    if (state.phase === 'not-found' || state.phase === 'error') {
        return (
            <UiPageContainer narrow className="justify-center">
                <UiSectionCard
                    title={
                        state.phase === 'not-found'
                            ? 'Отримувача не знайдено'
                            : 'Не вдалося завантажити отримувача. Оновіть сторінку'
                    }
                >
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href="/admin/payees"
                            variant="filled"
                            size="md"
                        >
                            До списку
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    return <AdminPayeeForm existing={state.business} />;
}
