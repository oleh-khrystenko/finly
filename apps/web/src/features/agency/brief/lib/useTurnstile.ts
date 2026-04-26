import { useEffect, useRef, useCallback } from 'react';
import { ENV } from '@/shared/config';

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string;
                    callback: (token: string) => void;
                    'error-callback'?: () => void;
                    'expired-callback'?: () => void;
                    size?: 'invisible' | 'normal' | 'compact';
                    execution?: 'render' | 'execute';
                },
            ) => string;
            execute: (widgetId: string) => void;
            remove: (widgetId: string) => void;
            reset: (widgetId: string) => void;
        };
    }
}

interface PendingChallenge {
    resolve: (token: string) => void;
    reject: (error: Error) => void;
}

export function useTurnstile() {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const pendingRef = useRef<PendingChallenge | null>(null);

    useEffect(() => {
        function renderWidget() {
            if (
                window.turnstile &&
                containerRef.current &&
                !widgetIdRef.current
            ) {
                widgetIdRef.current = window.turnstile.render(
                    containerRef.current,
                    {
                        sitekey: ENV.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
                        execution: 'execute',
                        callback: (t: string) => {
                            pendingRef.current?.resolve(t);
                            pendingRef.current = null;
                        },
                        'error-callback': () => {
                            pendingRef.current?.reject(
                                new Error('Challenge failed'),
                            );
                            pendingRef.current = null;
                        },
                        'expired-callback': () => {
                            pendingRef.current?.reject(
                                new Error('Challenge expired'),
                            );
                            pendingRef.current = null;
                        },
                        size: 'invisible',
                    },
                );
            }
        }

        // Script already loaded (e.g. another instance loaded it earlier)
        if (window.turnstile) {
            renderWidget();
            return;
        }

        const existingScript =
            document.querySelector<HTMLScriptElement>('script[src*="turnstile"]');

        if (existingScript) {
            // Script tag exists but hasn't finished loading yet
            existingScript.addEventListener('load', renderWidget);
            return () => existingScript.removeEventListener('load', renderWidget);
        }

        // Load Turnstile script for the first time
        const script = document.createElement('script');
        script.src =
            'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.addEventListener('load', renderWidget);
        document.head.appendChild(script);

        return () => {
            script.removeEventListener('load', renderWidget);
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, []);

    const execute = useCallback((): Promise<string> => {
        return new Promise((resolve, reject) => {
            if (!widgetIdRef.current || !window.turnstile) {
                reject(new Error('Turnstile not ready'));
                return;
            }
            pendingRef.current = { resolve, reject };
            window.turnstile.execute(widgetIdRef.current);
        });
    }, []);

    const reset = useCallback(() => {
        pendingRef.current = null;
        if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
        }
    }, []);

    return { containerRef, execute, reset };
}
