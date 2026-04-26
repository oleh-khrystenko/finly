// ============================================================
// FAIL FAST POLICY:
// Every env var is required. No fallbacks. No defaults in code.
// If a variable is missing, crash immediately.
//
// IMPORTANT: NEXT_PUBLIC_* vars MUST use direct process.env.VAR
// access (not dynamic process.env[name]) so Next.js can inline
// values into the client bundle at build time.
// ============================================================

function assertEnv(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`❌ Environment variable "${name}" is not defined`);
    }
    return value;
}

function parseOptionalAbsoluteUrl(
    value: string | undefined,
    name: string
): string | null {
    if (!value) {
        return null;
    }

    try {
        return new URL(value).toString();
    } catch {
        throw new Error(
            `❌ Environment variable "${name}" must be a valid absolute URL`
        );
    }
}

export const ENV = {
    NEXT_PUBLIC_BASE_URL: assertEnv(
        process.env.NEXT_PUBLIC_BASE_URL,
        'NEXT_PUBLIC_BASE_URL'
    ),
    NEXT_PUBLIC_API_URL: assertEnv(
        process.env.NEXT_PUBLIC_API_URL,
        'NEXT_PUBLIC_API_URL'
    ),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: assertEnv(
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        'NEXT_PUBLIC_TURNSTILE_SITE_KEY'
    ),
    // Hostname of the R2 public CDN. Used by next/image `remotePatterns`.
    // MUST equal the hostname of `R2_PUBLIC_URL` on the API — otherwise
    // next/image blocks uploaded photos at runtime.
    NEXT_PUBLIC_STORAGE_HOSTNAME: assertEnv(
        process.env.NEXT_PUBLIC_STORAGE_HOSTNAME,
        'NEXT_PUBLIC_STORAGE_HOSTNAME'
    ),
} as const;

export const PAYMENTS_SUBSCRIPTION_ENABLED =
    assertEnv(
        process.env.NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED,
        'NEXT_PUBLIC_PAYMENTS_SUBSCRIPTION_ENABLED'
    ) === 'true';

export const PAYMENTS_ONE_OFF_ENABLED =
    assertEnv(
        process.env.NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED,
        'NEXT_PUBLIC_PAYMENTS_ONE_OFF_ENABLED'
    ) === 'true';

const demoVideoSrc = parseOptionalAbsoluteUrl(
    process.env.NEXT_PUBLIC_DEMO_VIDEO_URL,
    'NEXT_PUBLIC_DEMO_VIDEO_URL'
);
const demoVideoPoster = parseOptionalAbsoluteUrl(
    process.env.NEXT_PUBLIC_DEMO_VIDEO_POSTER_URL,
    'NEXT_PUBLIC_DEMO_VIDEO_POSTER_URL'
);

if (!demoVideoSrc && demoVideoPoster) {
    throw new Error(
        '❌ Environment variable "NEXT_PUBLIC_DEMO_VIDEO_POSTER_URL" requires "NEXT_PUBLIC_DEMO_VIDEO_URL"'
    );
}

export const DEMO_VIDEO = demoVideoSrc
    ? {
          src: demoVideoSrc,
          poster: demoVideoPoster,
      }
    : null;

export const DEMO_VIDEO_ENABLED = DEMO_VIDEO !== null;
