const SESSION_KEY = 'brief_source';

function detectSource(): string {
    if (typeof window === 'undefined') return 'unknown';

    // 1. UTM parameter — highest priority, explicit attribution
    const utmSource = new URL(window.location.href).searchParams.get(
        'utm_source',
    );
    if (utmSource) return utmSource.toLowerCase();

    // 2. Referrer — full domain without www, preserves all information
    //    Examples: "linkedin.com", "t.co", "news.ycombinator.com"
    //    No hardcoded referrer map — normalization is an analytics concern, not a capture concern.
    if (document.referrer) {
        try {
            const referrerHostname = new URL(document.referrer).hostname.replace(
                /^www\./,
                '',
            );
            const ownHostname = window.location.hostname.replace(/^www\./, '');
            if (referrerHostname && referrerHostname !== ownHostname) {
                return referrerHostname;
            }
        } catch {
            // Invalid referrer URL — fall through to direct
        }
    }

    // 3. No UTM, no external referrer — direct visit
    return 'direct';
}

export function getSource(): string {
    if (typeof window === 'undefined') return 'unknown';

    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) return cached;

    const source = detectSource();
    sessionStorage.setItem(SESSION_KEY, source);
    return source;
}

export function initSource(): void {
    // Call on first page load to cache source before user navigates away.
    // sessionStorage is per-tab and clears on tab close — correct behavior
    // for first-touch attribution within a single visit session.
    getSource();
}
