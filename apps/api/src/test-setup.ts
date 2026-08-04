// Set test-only env vars that are required by fail-fast policy
// but not needed for unit tests (mocked at service level).
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '4000';
process.env.TRUST_PROXY_HOPS ??= '0';
// Хости тут СВІДОМО прод-подібні (два різні хости під спільним батьківським
// доменом), а не dev-ові `localhost:3000` / `localhost:3001`. Dev розділяє
// кабінет і pay-зону портом — випадок, у якому cookie-домен ні на що не
// впливає, бо порт у scope cookie не входить. Тести ж мусять покривати саме
// той випадок, що працює у проді: cookie на батьківському домені, видна
// сусідньому ПІДДОМЕНУ. Заміна на localhost знищила б це покриття, лишивши
// перевірки формально зеленими.
process.env.WEB_URL ??= 'http://finly.local:3000';
process.env.REVALIDATE_SECRET ??= 'test-revalidate-secret';
process.env.PAY_PUBLIC_URL ??= 'http://pay.finly.local:3000';
process.env.AUTH_COOKIE_DOMAIN ??= 'finly.local';
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.GOOGLE_CLIENT_ID ??= 'google-client-id-placeholder';
process.env.GOOGLE_CLIENT_SECRET ??= 'google-client-secret-placeholder';
process.env.GOOGLE_CALLBACK_URL ??=
    'http://finly.local:3000/api/auth/google/callback';
process.env.RESEND_API_KEY ??= 're_test_placeholder';
process.env.RESEND_FROM_EMAIL ??= 'Finly <test@test.dev>';
process.env.MONOBANK_TOKEN ??= 'test-monobank-token';
process.env.BILLING_DEMO_MODE ??= 'true';
process.env.GSC_SITE_URL ??= 'sc-domain:test.local';
process.env.GSC_CLIENT_EMAIL ??= 'test-gsc@test.iam.gserviceaccount.com';
process.env.GSC_PRIVATE_KEY ??=
    '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.R2_ACCOUNT_ID ??= 'test-account-id';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key-id';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-access-key';
process.env.R2_BUCKET_NAME ??= 'test-media-bucket';
process.env.R2_PUBLIC_URL ??= 'https://media.test.local';
