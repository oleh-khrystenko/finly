'use client';

import { useEffect, useState } from 'react';
import type { Account, Business } from '@finly/types';

import { adminGetPayee } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

import { AdminPayeeAccountForm } from './AdminPayeeAccountForm';

type LoadState =
    | { phase: 'loading' }
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
                        : { phase: 'error' }
                );
            })
            .catch(() => {
                if (active) setState({ phase: 'error' });
            });
        return () => {
            active = false;
        };
    }, [slug, accountSlug]);

    if (state.phase === 'loading') {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }
    if (state.phase === 'error') {
        return (
            <UiPageContainer className="py-12">
                <UiSectionCard title="Реквізити не знайдено">
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
