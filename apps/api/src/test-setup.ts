// Set test-only env vars that are required by fail-fast policy
// but not needed for unit tests (mocked at service level).
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '4000';
process.env.TRUST_PROXY_HOPS ??= '0';
process.env.WEB_URL ??= 'http://localhost:3000';
process.env.REVALIDATE_SECRET ??= 'test-revalidate-secret';
process.env.PAY_PUBLIC_URL ??= 'http://pay.finly.local:3000';
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.GOOGLE_CLIENT_ID ??= 'google-client-id-placeholder';
process.env.GOOGLE_CLIENT_SECRET ??= 'google-client-secret-placeholder';
process.env.GOOGLE_CALLBACK_URL ??=
    'http://localhost:4000/api/auth/google/callback';
process.env.RESEND_API_KEY ??= 're_test_placeholder';
process.env.RESEND_FROM_EMAIL ??= 'Finly <test@test.dev>';
process.env.MONOBANK_TOKEN ??= 'test-monobank-token';
process.env.BILLING_DEMO_MODE ??= 'true';
process.env.BILLING_DUNNING_MAX_ATTEMPTS ??= '4';
process.env.BILLING_DUNNING_RETRY_INTERVAL_HOURS ??= '48';
process.env.BILLING_BRAND_PRICE_PER_BUSINESS ??= '49';
process.env.BILLING_DOC_TIERS ??=
    '1:299:1000,5:1495:5000,10:2990:10000,20:5980:20000,50:14950:50000,100:29900:100000';
process.env.BILLING_DOC_STORAGE_GB_PER_BUSINESS ??= '5';
process.env.BILLING_DOC_STORAGE_RENT_CREDITS_PER_GB ??= '10';
process.env.BILLING_DOC_CREDIT_PACKS ??= '500:150,2000:500';
process.env.BILLING_DOC_LOW_BALANCE_THRESHOLD ??= '200';
process.env.BILLING_DOC_CRITICAL_BALANCE_THRESHOLD ??= '100';
process.env.BILLING_BRAND_ENABLED ??= 'true';
process.env.BILLING_DOCUMENTS_ENABLED ??= 'false';
process.env.AUTH_PASSWORD_MIN_LENGTH ??= '8';
process.env.AUTH_LOCKOUT_THRESHOLDS ??= '5:1,10:5,20:15';
process.env.AUTH_LOGIN_ATTEMPTS_TTL_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_TTL_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_RATE_LIMIT ??= '3';
process.env.AUTH_MAGIC_LINK_RATE_WINDOW_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_DEDUP_SEC ??= '60';
process.env.ACCOUNT_DELETION_GRACE_DAYS ??= '30';
process.env.ORPHAN_REMINDER_FIRST_DAYS ??= '1';
process.env.ORPHAN_REMINDER_FINAL_DAYS ??= '6';
process.env.ORPHAN_CLEANUP_DELETION_DAYS ??= '7';
process.env.BRAND_PENDING_CLEANUP_DAYS ??= '7';
process.env.BRAND_DEMOTED_CLEANUP_DAYS ??= '90';
process.env.GSC_SITE_URL ??= 'sc-domain:test.local';
process.env.GSC_CLIENT_EMAIL ??= 'test-gsc@test.iam.gserviceaccount.com';
process.env.GSC_PRIVATE_KEY ??=
    '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.HELP_CHAT_MAX_TOKENS ??= '400';
process.env.HELP_CHAT_IP_LIMIT ??= '20';
process.env.HELP_CHAT_DAILY_BUDGET ??= '1000';
process.env.R2_ACCOUNT_ID ??= 'test-account-id';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
process.env.R2_BUCKET_NAME ??= 'test-media-bucket';
process.env.R2_PUBLIC_URL ??= 'https://media.test.local';
