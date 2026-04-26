'use client';

import { useEffect } from 'react';
import { initSource } from '@/features/agency/brief/lib/source';

export function SourceTracker() {
    useEffect(() => {
        initSource();
    }, []);
    return null;
}
