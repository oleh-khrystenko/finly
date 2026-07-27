'use client';

import { useEffect, useState } from 'react';
import { RESPONSE_CODE, type Account, type Business } from '@finly/types';

import { adminGetPayee, extractApiErrorCode } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

import { AdminPayeeAccountForm } from './AdminPayeeAccountForm';

// `not-found` і `error` розділені: тимчасовий збій (мережа, 429, 500) не можна
// показувати як ствердне «запису не існує».
type LoadState =
    | { phase: 'loading' }
    | { phase: 'not-found' }
    | { phase: 'error' }
    | { phase: 'ready'; payee: Business; account: Account };

/**
 * Sprint 29 — завантажувач редагування реквізитів системного отримувача.
 * Дзеркалить `AdminPayeeEdit` (client-fetch + spinner/error), щоб сторінка
 * лишалась тонкою.
 *
 * Окремого GET на одні реквізити немає: адмін-детальний ендпоінт віддає
 * отримувача разом з усіма рахунками, тож потрібний знаходимо в цій відповіді.
 * Порівняння за lowercase — той самий case-insensitive контракт slug-ів, що на
 * бекенді (`slugLower`), інакше посилання з іншим регістром давало б «не
 * знайдено».
 */
export function AdminPayeeAccountEdit({
    slug,
    accountSlug,
}: {
    slug: string;
    accountSlug: string;
}) {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });

    useEffect(() => {
        let active = true;
        adminGetPayee(slug)
            .then(({ business, accounts }) => {
                if (!active) return;
                const account = accounts.find(
                    (a) => a.slugLower === accountSlug.toLowerCase()
                );
                setState(
                    account
                        ? { phase: 'ready', payee: business, account }
                        : { phase: 'not-found' }
                );
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
    }, [slug, accountSlug]);

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
                            ? 'Реквізити не знайдено'
                            : 'Не вдалося завантажити реквізити. Оновіть сторінку'
                    }
                >
                    <div className="mt-4">
                        <UiButton
                            as="link"
                            href={`/admin/payees/${slug}`}
                            variant="filled"
                            size="md"
                        >
                            До отримувача
                        </UiButton>
                    </div>
                </UiSectionCard>
            </UiPageContainer>
        );
    }

    return (
        <AdminPayeeAccountForm payee={state.payee} account={state.account} />
    );
}
