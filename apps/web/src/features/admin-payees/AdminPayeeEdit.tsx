'use client';

import { useEffect, useState } from 'react';
import type { Business } from '@finly/types';

import { adminGetPayee } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

import { AdminPayeeForm } from './AdminPayeeForm';

type LoadState =
    | { phase: 'loading' }
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
            .catch(() => {
                if (active) setState({ phase: 'error' });
            });
        return () => {
            active = false;
        };
    }, [slug]);

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
                <UiSectionCard title="Отримувача не знайдено">
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
