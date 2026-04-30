// Set test-only env vars that are required by fail-fast policy
// but not needed for unit tests (mocked at service level).
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '4000';
process.env.WEB_URL ??= 'http://localhost:3000';
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
process.env.STRIPE_SECRET_KEY ??= 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_test_placeholder';
process.env.PAYMENTS_SUBSCRIPTION_ENABLED ??= 'true';
process.env.PAYMENTS_ONE_OFF_ENABLED ??= 'true';
process.env.AUTH_PASSWORD_MIN_LENGTH ??= '8';
process.env.AUTH_LOCKOUT_THRESHOLDS ??= '5:1,10:5,20:15';
process.env.AUTH_LOGIN_ATTEMPTS_TTL_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_TTL_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_RATE_LIMIT ??= '3';
process.env.AUTH_MAGIC_LINK_RATE_WINDOW_MIN ??= '15';
process.env.AUTH_MAGIC_LINK_DEDUP_SEC ??= '60';
process.env.ACCOUNT_DELETION_GRACE_DAYS ??= '30';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.AI_CHAT_MAX_TOKENS ??= '800';
process.env.AI_CHAT_IP_LIMIT ??= '5';
process.env.R2_ACCOUNT_ID ??= 'test-account-id';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
process.env.R2_BUCKET_NAME ??= 'test-media-bucket';
process.env.R2_PUBLIC_URL ??= 'https://media.test.local';
