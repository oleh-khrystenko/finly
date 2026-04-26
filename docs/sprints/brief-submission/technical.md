# Brief Submission: Technical Spec

> Технічна специфікація для AI agents. Кожен крок — самодостатній блок з файлами, кодом та залежностями.

---

## Передумови

Перед початком прочитай:
- `docs/conventions/modular-boundaries.md` — agency ізоляція
- `docs/conventions/tone.md` — стиль user-facing повідомлень
- `docs/conventions/fail-fast.md` — env vars policy
- `docs/conventions/i18n.md` — response codes → i18n keys
- `docs/conventions/ui-primitives.md` — заборонені raw HTML елементи
- `docs/conventions/design-tokens.md` — кольори тільки через токени

---

## Крок 1: Shared types — Zod schema, enums, constants

**Файли:** `packages/types/src/validation/`, `packages/types/src/agency/`

### 1.0. Shared name validation

Файл: `packages/types/src/validation/common.ts`

В `UpdateProfileSchema` (`packages/types/src/contracts/users.ts`) вже є name validation:

```typescript
name: z.string().trim().min(2).max(100).regex(/^[\p{L}\s'\-]+$/u)
```

Цей паттерн потрібен і в `SubmitBriefSchema`. Винести як shared primitive:

```typescript
// packages/types/src/validation/common.ts
import { z } from 'zod';

/** Unicode letters, spaces, apostrophes, hyphens. Min 2, max 100 chars. */
export const nameSchema = z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[\p{L}\s'\-]+$/u);
```

Оновити `UpdateProfileSchema` щоб використовував `nameSchema`:

```typescript
// packages/types/src/contracts/users.ts
import { nameSchema } from '../validation/common';

export const UpdateProfileSchema = z.object({
    name: nameSchema.optional(),
    avatar: z.string().url().optional(),
    preferredLang: z.enum(langValues).optional(),
});
```

### 1.1. Brief status enum

Файл: `packages/types/src/agency/brief.ts`

```typescript
import { z } from 'zod';
import { nameSchema } from '../validation/common';

// --- Enums ---

export const BRIEF_STATUS = {
    NEW: 'new',
    IN_REVIEW: 'in_review',
    RESPONDED: 'responded',
    REJECTED: 'rejected',
    ARCHIVED: 'archived',
} as const;

export type BriefStatus = (typeof BRIEF_STATUS)[keyof typeof BRIEF_STATUS];

export const BRIEF_BUDGET = {
    UNDER_2500: 'under_2500',
    FROM_2500_TO_5000: '2500_5000',
    FROM_5000_TO_10000: '5000_10000',
    OVER_10000: 'over_10000',
} as const;

export type BriefBudget = (typeof BRIEF_BUDGET)[keyof typeof BRIEF_BUDGET];

export const BRIEF_DEADLINE = {
    ASAP: 'asap',
    ONE_TO_THREE_MONTHS: '1_3_months',
    FLEXIBLE: 'flexible',
} as const;

export type BriefDeadline = (typeof BRIEF_DEADLINE)[keyof typeof BRIEF_DEADLINE];

// --- Submission schema (shared between frontend & backend) ---

export const SubmitBriefSchema = z.object({
    name: nameSchema,
    email: z.string().trim().email().max(254),
    description: z.string().trim().min(10).max(5000),
    budget: z.enum([
        BRIEF_BUDGET.UNDER_2500,
        BRIEF_BUDGET.FROM_2500_TO_5000,
        BRIEF_BUDGET.FROM_5000_TO_10000,
        BRIEF_BUDGET.OVER_10000,
    ]),
    deadline: z
        .enum([
            BRIEF_DEADLINE.ASAP,
            BRIEF_DEADLINE.ONE_TO_THREE_MONTHS,
            BRIEF_DEADLINE.FLEXIBLE,
        ])
        .optional(),
    source: z.string().max(253).optional(),
    lang: z.string().min(2).max(5),
    captchaToken: z.string().min(1),
});

export type SubmitBrief = z.infer<typeof SubmitBriefSchema>;

// --- Human-readable labels (for notification emails, admin UI) ---

export const BRIEF_BUDGET_LABEL: Record<BriefBudget, string> = {
    [BRIEF_BUDGET.UNDER_2500]: '< $2,500 (Consulting only)',
    [BRIEF_BUDGET.FROM_2500_TO_5000]: '$2,500 – $5,000',
    [BRIEF_BUDGET.FROM_5000_TO_10000]: '$5,000 – $10,000',
    [BRIEF_BUDGET.OVER_10000]: '$10,000+',
};

export const BRIEF_DEADLINE_LABEL: Record<BriefDeadline, string> = {
    [BRIEF_DEADLINE.ASAP]: 'ASAP',
    [BRIEF_DEADLINE.ONE_TO_THREE_MONTHS]: '1–3 months',
    [BRIEF_DEADLINE.FLEXIBLE]: 'Flexible',
};
```

**Зміни vs попередня версія:**
- `name` → `nameSchema` (shared, regex validated, min 2)
- `source` max → 253 (max довжина hostname за RFC 1035)
- `BRIEF_BUDGET_LABEL` / `BRIEF_DEADLINE_LABEL` — human-readable labels для notification email та майбутньої адмінки

### 1.2. Export з agency barrel

Файл: `packages/types/src/agency/index.ts`

```typescript
export * from './brief';
```

### 1.3. Response codes

Файл: `packages/types/src/enums/response-code.ts` — додати:

```typescript
// --- agency success ---
BRIEF_SUBMITTED: 'BRIEF_SUBMITTED',
```

І в `RESPONSE_CODE_TYPE`:

```typescript
[RESPONSE_CODE.BRIEF_SUBMITTED]: RESPONSE_TYPE.SUCCESS,
```

### 1.4. Rebuild types

```bash
pnpm --filter @cyanship/types build
```

---

## Крок 2: API — AgencyModule, Brief schema, BriefService, BriefController

### 2.1. Mongoose schema

Файл: `apps/api/src/modules/agency/schemas/brief.schema.ts`

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BRIEF_STATUS, type BriefStatus, type BriefBudget, type BriefDeadline } from '@cyanship/types';

@Schema({ timestamps: true, collection: 'briefs' })
export class Brief extends Document {
    @Prop({ required: true, trim: true })
    name: string;

    @Prop({ required: true, trim: true, lowercase: true })
    email: string;

    @Prop({ required: true, trim: true })
    description: string;

    @Prop({ required: true })
    budget: BriefBudget;

    @Prop({ default: null })
    deadline: BriefDeadline | null;

    @Prop({ default: null })
    source: string | null;

    @Prop({ default: null })
    lang: string | null;

    @Prop({ default: BRIEF_STATUS.NEW, index: true })
    status: BriefStatus;

    // timestamps: true дає createdAt, updatedAt
    createdAt: Date;
    updatedAt: Date;
}

export const BriefSchema = SchemaFactory.createForClass(Brief);
```

### 2.2. DTO

Файл: `apps/api/src/modules/agency/dto/submit-brief.dto.ts`

```typescript
import { createZodDto } from '@anatine/zod-nestjs';
import { SubmitBriefSchema } from '@cyanship/types';

export class SubmitBriefDto extends createZodDto(SubmitBriefSchema) {}
```

### 2.3. Turnstile verification service

Файл: `apps/api/src/modules/agency/services/turnstile.service.ts`

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RESPONSE_CODE } from '@cyanship/types';
import { ENV } from '../../../config/env';

interface TurnstileVerifyResponse {
    success: boolean;
    'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
    private readonly logger = new Logger(TurnstileService.name);
    private readonly verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    async verify(token: string, remoteIp?: string): Promise<void> {
        const body: Record<string, string> = {
            secret: ENV.TURNSTILE_SECRET_KEY,
            response: token,
        };

        if (remoteIp) {
            body.remoteip = remoteIp;
        }

        const response = await fetch(this.verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body),
        });

        const result = (await response.json()) as TurnstileVerifyResponse;

        if (!result.success) {
            this.logger.warn(
                `Turnstile verification failed: ${result['error-codes']?.join(', ') ?? 'unknown'}`,
            );
            throw new BadRequestException({
                code: RESPONSE_CODE.CAPTCHA_FAILED,
                message: 'Captcha verification failed',
            });
        }
    }
}
```

**Увага:** `CAPTCHA_FAILED` — новий response code (додати в Крок 1.3):

```typescript
// --- agency error ---
CAPTCHA_FAILED: 'CAPTCHA_FAILED',
```

В `RESPONSE_CODE_TYPE`:

```typescript
[RESPONSE_CODE.CAPTCHA_FAILED]: RESPONSE_TYPE.ERROR,
```

### 2.4. BriefService

Файл: `apps/api/src/modules/agency/services/brief.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    BRIEF_STATUS,
    BRIEF_BUDGET_LABEL,
    BRIEF_DEADLINE_LABEL,
    type BriefBudget,
    type BriefDeadline,
} from '@cyanship/types';

import { EmailService } from '../../email/email.service';
import { Brief } from '../schemas/brief.schema';
import type { SubmitBriefDto } from '../dto/submit-brief.dto';

@Injectable()
export class BriefService {
    private readonly logger = new Logger(BriefService.name);

    constructor(
        @InjectModel(Brief.name) private readonly briefModel: Model<Brief>,
        private readonly emailService: EmailService,
    ) {}

    async submit(dto: SubmitBriefDto): Promise<void> {
        const brief = await this.briefModel.create({
            name: dto.name,
            email: dto.email,
            description: dto.description,
            budget: dto.budget,
            deadline: dto.deadline ?? null,
            source: dto.source ?? null,
            lang: dto.lang ?? null,
            status: BRIEF_STATUS.NEW,
        });

        this.logger.log(`Brief submitted: ${brief._id} from ${dto.email}`);

        // Fire-and-forget: emails should not block the response
        // but we still log failures
        await Promise.allSettled([
            this.emailService.sendBriefConfirmation({
                email: dto.email,
                name: dto.name,
                lang: dto.lang,
            }),
            this.emailService.sendBriefNotification({
                name: dto.name,
                email: dto.email,
                description: dto.description,
                budget: dto.budget,
                budgetLabel: BRIEF_BUDGET_LABEL[dto.budget as BriefBudget],
                deadline: dto.deadline ?? null,
                deadlineLabel: dto.deadline
                    ? BRIEF_DEADLINE_LABEL[dto.deadline as BriefDeadline]
                    : null,
                source: dto.source ?? null,
            }),
        ]).then((results) => {
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    const target = i === 0 ? 'confirmation' : 'notification';
                    this.logger.error(
                        `Failed to send brief ${target} email: ${r.reason}`,
                    );
                }
            });
        });
    }
}
```

**Ключове рішення:** Emails відправляються через `Promise.allSettled` — якщо email не вдалося відправити, бриф все одно зберігається в базі. Це правильна поведінка: дані не втрачаються, email failure логується для debug. Якщо потрібна гарантована доставка — це окремий sprint з retry queue.

### 2.5. BriefController

Файл: `apps/api/src/modules/agency/brief.controller.ts`

```typescript
import { Body, Controller, Ip, Post } from '@nestjs/common';
import { RESPONSE_CODE } from '@cyanship/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { SubmitBriefDto } from './dto/submit-brief.dto';
import { BriefService } from './services/brief.service';
import { TurnstileService } from './services/turnstile.service';

@Controller('agency')
export class BriefController {
    constructor(
        private readonly briefService: BriefService,
        private readonly turnstileService: TurnstileService,
    ) {}

    @Post('brief')
    @SkipOnboarding()
    async submitBrief(
        @Body() dto: SubmitBriefDto,
        @Ip() ip: string,
    ): Promise<{ data: null; code: string }> {
        await this.turnstileService.verify(dto.captchaToken, ip);
        await this.briefService.submit(dto);

        return {
            data: null,
            code: RESPONSE_CODE.BRIEF_SUBMITTED,
        };
    }
}
```

**Примітки:**
- Без auth guard — публічний endpoint
- `@SkipOnboarding()` — не вимагає completed profile
- Throttle залишається (глобальний 60 req/min) — цього достатньо разом з Turnstile
- Turnstile верифікація ДО збереження — запобігає spam записам в БД

### 2.6. AgencyModule

Файл: `apps/api/src/modules/agency/agency.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Brief, BriefSchema } from './schemas/brief.schema';
import { BriefController } from './brief.controller';
import { BriefService } from './services/brief.service';
import { TurnstileService } from './services/turnstile.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Brief.name, schema: BriefSchema }]),
    ],
    controllers: [BriefController],
    providers: [BriefService, TurnstileService],
})
export class AgencyModule {}
```

### 2.7. Підключення до AppModule

Файл: `apps/api/src/app.module.ts` — додати `AgencyModule` до imports:

```typescript
import { AgencyModule } from './modules/agency/agency.module';

// В @Module imports:
AgencyModule,
```

---

## Крок 3: Email templates — confirmation та notification

### 3.1. Email i18n types

Файл: `apps/api/src/modules/email/i18n/types.ts` — додати:

```typescript
export interface BriefConfirmationTranslations {
    subject: string;
    body: (name: string) => string;
    footer: string;
}
```

### 3.2. Email i18n translations

Файл: `apps/api/src/modules/email/i18n/en.ts` — додати в об'єкт:

```typescript
briefConfirmation: {
    subject: 'We received your project request',
    body: (name: string) =>
        `Thank you, ${name}. We have received your project brief and will review it within 24 hours. You will receive a detailed response to this email address.`,
    footer: 'If you did not submit this request, you can safely ignore this email.',
},
```

Файл: `apps/api/src/modules/email/i18n/uk.ts` — додати:

```typescript
briefConfirmation: {
    subject: 'Ми отримали ваш запит',
    body: (name: string) =>
        `Дякуємо, ${name}. Ми отримали ваш бриф та розглянемо його протягом 24 годин. Детальну відповідь ви отримаєте на цю електронну адресу.`,
    footer: 'Якщо ви не відправляли цей запит, просто проігноруйте цей лист.',
},
```

Файл: `apps/api/src/modules/email/i18n/types.ts` — оновити `EmailTranslations`:

```typescript
export interface EmailTranslations {
    magicLink: Record<MagicLinkPurpose, MagicLinkTranslations>;
    deletionConfirmation: DeletionConfirmationTranslations;
    deletionReminder: DeletionReminderTranslations;
    briefConfirmation: BriefConfirmationTranslations;
}
```

### 3.3. Brief confirmation email template

Файл: `apps/api/src/modules/email/templates/brief-confirmation.tsx`

```tsx
import { Text } from '@react-email/components';
import { EMAIL_COLORS } from '@cyanship/types';

import type { BriefConfirmationTranslations } from '../i18n/types';
import { BaseLayout } from './layouts/base';

interface BriefConfirmationEmailProps {
    name: string;
    translations: BriefConfirmationTranslations;
    lang: string;
}

export function BriefConfirmationEmail({
    name,
    translations: t,
    lang,
}: BriefConfirmationEmailProps) {
    return (
        <BaseLayout lang={lang}>
            <Text style={bodyText}>{t.body(name)}</Text>
            <Text style={footer}>{t.footer}</Text>
        </BaseLayout>
    );
}

const bodyText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '16px',
    marginBottom: '32px',
};

const footer: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    marginTop: '32px',
};
```

### 3.4. Brief notification email template (internal)

Файл: `apps/api/src/modules/email/templates/brief-notification.tsx`

```tsx
import { Text, Hr } from '@react-email/components';
import { EMAIL_COLORS } from '@cyanship/types';

import { BaseLayout } from './layouts/base';

interface BriefNotificationEmailProps {
    name: string;
    email: string;
    description: string;
    budget: string;
    budgetLabel: string;
    deadline: string | null;
    deadlineLabel: string | null;
    source: string | null;
}

export function BriefNotificationEmail({
    name,
    email,
    description,
    budgetLabel,
    deadlineLabel,
    source,
}: BriefNotificationEmailProps) {
    return (
        <BaseLayout lang="en">
            <Text style={heading}>New Brief Submission</Text>
            <Hr style={divider} />
            <Text style={field}><strong>Name:</strong> {name}</Text>
            <Text style={field}><strong>Email:</strong> {email}</Text>
            <Text style={field}><strong>Budget:</strong> {budgetLabel}</Text>
            {deadlineLabel && <Text style={field}><strong>Deadline:</strong> {deadlineLabel}</Text>}
            {source && <Text style={field}><strong>Source:</strong> {source}</Text>}
            <Hr style={divider} />
            <Text style={descriptionLabel}><strong>Description:</strong></Text>
            <Text style={descriptionText}>{description}</Text>
        </BaseLayout>
    );
}

const heading: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '20px',
    fontWeight: 700,
    marginBottom: '8px',
};

const divider: React.CSSProperties = {
    borderColor: EMAIL_COLORS.background,
    margin: '16px 0',
};

const field: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '14px',
    margin: '4px 0',
    textAlign: 'left' as const,
};

const descriptionLabel: React.CSSProperties = {
    ...field,
    marginBottom: '0',
};

const descriptionText: React.CSSProperties = {
    color: EMAIL_COLORS.foreground,
    fontSize: '14px',
    textAlign: 'left' as const,
    whiteSpace: 'pre-wrap' as const,
    marginTop: '4px',
};
```

### 3.5. EmailService — нові методи

Файл: `apps/api/src/modules/email/email.service.ts` — додати два методи:

```typescript
async sendBriefConfirmation(params: {
    email: string;
    name: string;
    lang: string;
}): Promise<void> {
    const { email, name, lang } = params;
    const t = resolveTranslations(lang);

    await this.send({
        to: email,
        subject: t.briefConfirmation.subject,
        react: BriefConfirmationEmail({
            name,
            translations: t.briefConfirmation,
            lang,
        }),
    });

    this.logger.log(`Brief confirmation sent to ${email}`);
}

async sendBriefNotification(params: {
    name: string;
    email: string;
    description: string;
    budget: string;
    budgetLabel: string;
    deadline: string | null;
    deadlineLabel: string | null;
    source: string | null;
}): Promise<void> {
    await this.send({
        to: ENV.BRIEF_NOTIFICATION_EMAIL,
        subject: `New brief: ${params.name} — ${params.budgetLabel}`,
        react: BriefNotificationEmail(params),
    });

    this.logger.log(`Brief notification sent for ${params.email}`);
}
```

Додати imports: `BriefConfirmationEmail`, `BriefNotificationEmail`.

---

## Крок 4: Environment variables

### 4.1. API env

Файл: `apps/api/src/config/env.ts` — додати:

```typescript
TURNSTILE_SECRET_KEY: getEnvVar('TURNSTILE_SECRET_KEY'),
BRIEF_NOTIFICATION_EMAIL: getEnvVar('BRIEF_NOTIFICATION_EMAIL'),
```

### 4.2. Web env

Файл: `apps/web/src/shared/config/env.ts` — додати:

```typescript
NEXT_PUBLIC_TURNSTILE_SITE_KEY: assertEnv(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
),
```

### 4.3. Test setup

Файл: `apps/api/src/test-setup.ts` — додати:

```typescript
process.env.TURNSTILE_SECRET_KEY ??= 'turnstile-test-secret';
process.env.BRIEF_NOTIFICATION_EMAIL ??= 'test@test.dev';
```

### 4.4. .env.example

Додати:

```env
# Cloudflare Turnstile
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=

# Brief notifications
BRIEF_NOTIFICATION_EMAIL=
```

### 4.5. .env — додати реальні значення

Cloudflare Turnstile ключі отримуються з Cloudflare Dashboard → Turnstile → створити site widget. `BRIEF_NOTIFICATION_EMAIL` — адреса власника для нотифікацій.

---

## Крок 5: Frontend — source tracking

### 5.1. Source detection utility

Файл: `apps/web/src/features/agency/brief/lib/source.ts`

```typescript
const SESSION_KEY = 'brief_source';

function detectSource(): string {
    if (typeof window === 'undefined') return 'unknown';

    // 1. UTM parameter — highest priority, explicit attribution
    const utmSource = new URL(window.location.href).searchParams.get('utm_source');
    if (utmSource) return utmSource.toLowerCase();

    // 2. Referrer — full domain without www, preserves all information
    //    Examples: "linkedin.com", "t.co", "news.ycombinator.com"
    //    No hardcoded referrer map — normalization is an analytics concern, not a capture concern.
    if (document.referrer) {
        try {
            const referrerHostname = new URL(document.referrer).hostname.replace(/^www\./, '');
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
```

**Чому sessionStorage, а не альтернативи:**

| Варіант | Проблема |
|---------|----------|
| `localStorage` | Зберігає source назавжди — повернувся через місяць напряму, а source досі `linkedin`. Хибна атрибуція. |
| `Zustand (in-memory)` | Втрачається при hard refresh (F5). Page refresh ≠ новий візит. |
| `Cookie` | Працює, але потребує GDPR consent для non-essential cookies. Зайва складність. |
| **`sessionStorage`** | Per-tab, очищується при закритті вкладки. Кожна вкладка = окремий візит intent. Переживає навігацію по SPA та hard refresh. |

**Чому повний домен замість маппінгу:**
- `t.co`, `l.facebook.com`, `news.ycombinator.com` — зберігаються as-is
- Жодна інформація не втрачається
- Нормалізація (`t.co` → `x`) — задача аналітичного шару, а не форми збору даних
- Hardcoded map гарантовано стане outdated

### 5.2. Source initialization

Файл: `apps/web/src/app/[locale]/(agency)/page.tsx` — або в layout

Виклик `initSource()` при першому рендері agency landing. Варіант реалізації: client component wrapper або `useEffect` в існуючому layout.

```typescript
'use client';

import { useEffect } from 'react';
import { initSource } from '@/features/agency/brief/lib/source';

export function SourceTracker() {
    useEffect(() => {
        initSource();
    }, []);
    return null;
}
```

Розмістити `<SourceTracker />` в agency layout або landing page.

---

## Крок 6: Frontend — UI primitives та BriefForm компонент

### 6.0a. UiTextarea компонент

Конвенція `ui-primitives.md` забороняє raw HTML form елементи. `UiTextarea` не існує в UI kit — створити як частину цього спринту. Структура ідентична `UiInput`: forwardRef, variant/size стилі, error prop.

Файл: `apps/web/src/shared/ui/UiTextarea/types.ts`

```typescript
import { TextareaHTMLAttributes } from 'react';

export type UiTextareaVariant = 'outlined' | 'filled';
export type UiTextareaSize = 'sm' | 'md' | 'lg';

export interface UiTextareaProps extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'size'
> {
    variant?: UiTextareaVariant;
    size?: UiTextareaSize;
    error?: string;
}
```

Файл: `apps/web/src/shared/ui/UiTextarea/UiTextarea.tsx`

```typescript
'use client';

import { forwardRef } from 'react';
import { composeClasses } from '@/shared/lib';
import type { UiTextareaProps, UiTextareaSize, UiTextareaVariant } from './types';

const sizeStyles: Record<UiTextareaSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const variantStyles: Record<UiTextareaVariant, string> = {
    outlined:
        'bg-transparent text-foreground border border-border hover:border-muted-foreground focus-within:border-primary',
    filled: 'bg-secondary text-foreground border border-transparent hover:bg-card focus-within:bg-card',
};

const errorStyles = 'border-destructive hover:border-destructive focus-within:border-destructive';

const UiTextarea = forwardRef<HTMLTextAreaElement, UiTextareaProps>((props, ref) => {
    const {
        variant = 'outlined',
        size = 'md',
        error,
        className,
        disabled,
        ...textareaProps
    } = props;

    const wrapperClasses = composeClasses(
        'rounded-md transition-colors',
        sizeStyles[size],
        variantStyles[variant],
        error && errorStyles,
        disabled && 'opacity-50 cursor-not-allowed',
        className
    );

    return (
        <div>
            <div className={wrapperClasses} data-variant={variant} data-size={size}>
                <textarea
                    {...textareaProps}
                    ref={ref}
                    disabled={disabled}
                    className="w-full resize-y bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                />
            </div>
            {error && (
                <p className="mt-1 text-sm text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
});

UiTextarea.displayName = 'UiTextarea';

export default UiTextarea;
```

Файл: `apps/web/src/shared/ui/UiTextarea/index.ts`

```typescript
export type { UiTextareaProps, UiTextareaSize, UiTextareaVariant } from './types';
export { default } from './UiTextarea';
```

Оновити `docs/conventions/ui-primitives.md` — додати `UiTextarea` до реєстру компонентів.

### 6.0b. UiModal компонент

`UiSheet` — це side panel (slide-in з краю екрану). Для centered dialog потрібна окрема абстракція. Перевикористання `UiSheet` з responsive className overrides — це хак, що бореться з вбудованими стилями компонента.

`UiModal` — centered modal dialog на `@radix-ui/react-dialog` (вже встановлений як залежність `UiSheet`). На mobile (< md) він розтягується на весь екран знизу як bottom sheet. На desktop — centered overlay з max-width.

Файл: `apps/web/src/shared/ui/UiModal/types.ts`

```typescript
import type { ComponentPropsWithoutRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export interface UiModalProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Root> {}
export interface UiModalTriggerProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger> {}
export interface UiModalCloseProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Close> {}

export interface UiModalContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    hideOverlay?: boolean;
}

export interface UiModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}
export interface UiModalTitleProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Title> {}
```

Файл: `apps/web/src/shared/ui/UiModal/UiModal.tsx`

```typescript
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type {
    UiModalProps,
    UiModalTriggerProps,
    UiModalCloseProps,
    UiModalContentProps,
    UiModalHeaderProps,
    UiModalTitleProps,
} from './types';

function UiModal({ ...props }: UiModalProps) {
    return <DialogPrimitive.Root {...props} />;
}

function UiModalTrigger({ ...props }: UiModalTriggerProps) {
    return <DialogPrimitive.Trigger {...props} />;
}

function UiModalClose({ ...props }: UiModalCloseProps) {
    return <DialogPrimitive.Close {...props} />;
}

function UiModalOverlay({ className }: { className?: string }) {
    return (
        <DialogPrimitive.Overlay
            className={composeClasses(
                'fixed inset-0 z-50 bg-black/50',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                className
            )}
        />
    );
}

function UiModalContent({
    className,
    children,
    hideOverlay = false,
    ...props
}: UiModalContentProps) {
    return (
        <DialogPrimitive.Portal>
            {!hideOverlay && <UiModalOverlay />}
            <DialogPrimitive.Content
                className={composeClasses(
                    'bg-background fixed z-50 flex flex-col',
                    'transition ease-in-out',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    'data-[state=closed]:duration-200 data-[state=open]:duration-300',
                    // Mobile: bottom sheet layout
                    'inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl border-t shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.15)]',
                    // Desktop: centered modal layout
                    'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85vh] md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:shadow-lg',
                    className
                )}
                {...props}
            >
                {children}
                <DialogPrimitive.Close
                    className={composeClasses(
                        'absolute top-3 right-4 flex size-8 items-center justify-center rounded-md opacity-70 transition-opacity',
                        'hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none',
                        'disabled:pointer-events-none'
                    )}
                >
                    <X className="size-5" />
                    <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

function UiModalHeader({ className, ...props }: UiModalHeaderProps) {
    return (
        <div
            className={composeClasses(
                'flex flex-col gap-1.5 p-4',
                className
            )}
            {...props}
        />
    );
}

function UiModalTitle({ className, ...props }: UiModalTitleProps) {
    return (
        <DialogPrimitive.Title
            className={composeClasses(
                'text-foreground font-semibold',
                className
            )}
            {...props}
        />
    );
}

export {
    UiModal,
    UiModalTrigger,
    UiModalClose,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
};
```

Файл: `apps/web/src/shared/ui/UiModal/index.ts`

```typescript
export type {
    UiModalProps,
    UiModalTriggerProps,
    UiModalCloseProps,
    UiModalContentProps,
    UiModalHeaderProps,
    UiModalTitleProps,
} from './types';
export {
    UiModal,
    UiModalTrigger,
    UiModalClose,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from './UiModal';
```

**Чому окремий компонент, а не responsive UiSheet:**
- `UiSheet` має hardcoded `slideStyles` з `inset-y-0 right-0` / `inset-x-0 bottom-0` — override через className бореться з цими стилями
- `UiModal` — reusable для будь-яких confirmation/form dialogs в проєкті
- Обидва побудовані на `@radix-ui/react-dialog` — zero нових залежностей

**Анімація:** Одна анімація (fade + zoom) для обох layout. Різні анімації для mobile/desktop через Tailwind responsive variants не працюють коректно — mobile класи (`slide-in-from-bottom`) не скасовуються на desktop, а компонуються з desktop класами. Fade + zoom природно працює і для bottom sheet, і для centered modal.

Оновити `docs/conventions/ui-primitives.md` — додати `UiModal` до реєстру компонентів.

### 6.1. API wrapper

Файл: `apps/web/src/shared/api/agency.ts`

```typescript
import { apiClient } from './client';
import type { SubmitBrief } from '@cyanship/types';

export async function submitBrief(data: SubmitBrief): Promise<{ code: string }> {
    const { data: response } = await apiClient.post<{ data: null; code: string }>(
        '/agency/brief',
        data,
    );
    return { code: response.code };
}
```

### 6.2. Turnstile hook

Файл: `apps/web/src/features/agency/brief/lib/useTurnstile.ts`

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { ENV } from '@/shared/config';

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: {
                sitekey: string;
                callback: (token: string) => void;
                'error-callback'?: () => void;
                'expired-callback'?: () => void;
                size?: 'invisible' | 'normal' | 'compact';
            }) => string;
            remove: (widgetId: string) => void;
            reset: (widgetId: string) => void;
        };
    }
}

export function useTurnstile() {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        // Load Turnstile script if not already loaded
        if (!document.querySelector('script[src*="turnstile"]')) {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            document.head.appendChild(script);
        }

        const interval = setInterval(() => {
            if (window.turnstile && containerRef.current && !widgetIdRef.current) {
                widgetIdRef.current = window.turnstile.render(containerRef.current, {
                    sitekey: ENV.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
                    callback: (t: string) => setToken(t),
                    'error-callback': () => setToken(null),
                    'expired-callback': () => setToken(null),
                    size: 'invisible',
                });
                clearInterval(interval);
            }
        }, 100);

        return () => {
            clearInterval(interval);
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }
        };
    }, []);

    const reset = useCallback(() => {
        setToken(null);
        if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
        }
    }, []);

    return { containerRef, token, reset };
}
```

### 6.3. BriefForm component

Файл: `apps/web/src/features/agency/brief/BriefForm.tsx`

```typescript
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { SubmitBriefSchema, BRIEF_BUDGET, BRIEF_DEADLINE } from '@cyanship/types';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiSelect from '@/shared/ui/UiSelect';
import { submitBrief } from '@/shared/api/agency';
import { getApiMessageKey } from '@/shared/api/mapApiCode';
import { getSource } from './lib/source';
import { useTurnstile } from './lib/useTurnstile';

interface BriefFormProps {
    onSuccess: () => void;
}

export default function BriefForm({ onSuccess }: BriefFormProps) {
    const t = useTranslations('brief_form');
    const tNotifications = useTranslations('notifications');
    const tErrors = useTranslations('errors');

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [description, setDescription] = useState('');
    const [budget, setBudget] = useState('');
    const [deadline, setDeadline] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { containerRef, token, reset: resetTurnstile } = useTurnstile();

    const budgetOptions = [
        { value: BRIEF_BUDGET.UNDER_2500, label: t('budget_under_2500') },
        { value: BRIEF_BUDGET.FROM_2500_TO_5000, label: t('budget_2500_5000') },
        { value: BRIEF_BUDGET.FROM_5000_TO_10000, label: t('budget_5000_10000') },
        { value: BRIEF_BUDGET.OVER_10000, label: t('budget_over_10000') },
    ];

    const deadlineOptions = [
        { value: BRIEF_DEADLINE.ASAP, label: t('deadline_asap') },
        { value: BRIEF_DEADLINE.ONE_TO_THREE_MONTHS, label: t('deadline_1_3_months') },
        { value: BRIEF_DEADLINE.FLEXIBLE, label: t('deadline_flexible') },
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});

        if (!token) {
            toast.error(t('captcha_not_ready'));
            return;
        }

        const payload = {
            name,
            email,
            description,
            budget,
            ...(deadline && { deadline }),
            source: getSource(),
            lang: navigator.language.slice(0, 5),
            captchaToken: token,
        };

        const result = SubmitBriefSchema.safeParse(payload);
        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            result.error.issues.forEach((issue) => {
                const field = issue.path[0]?.toString();
                if (field) fieldErrors[field] = t(`validation_${field}`);
            });
            setErrors(fieldErrors);
            return;
        }

        setLoading(true);
        try {
            const { code } = await submitBrief(result.data);
            const messageKey = getApiMessageKey(code, 'agency');
            toast.success(tNotifications(messageKey));
            onSuccess();
        } catch (err) {
            resetTurnstile();
            // Pattern from ChangePasswordForm: AxiosError type guard
            const code = err instanceof AxiosError
                ? err.response?.data?.error?.code
                : undefined;
            if (code) {
                const messageKey = getApiMessageKey(code, 'agency');
                toast.error(tErrors(messageKey));
            } else {
                toast.error(tErrors('generic.unknown'));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <UiInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('name_placeholder')}
                error={errors.name}
                disabled={loading}
                required
            />
            <UiInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('email_placeholder')}
                error={errors.email}
                disabled={loading}
                required
            />
            <UiTextarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('description_placeholder')}
                rows={4}
                error={errors.description}
                disabled={loading}
                required
            />
            <UiSelect
                options={budgetOptions}
                value={budget}
                onChange={setBudget}
                placeholder={t('budget_placeholder')}
                variant="outlined"
            />
            {errors.budget && (
                <p className="text-sm text-destructive">{errors.budget}</p>
            )}
            <UiSelect
                options={deadlineOptions}
                value={deadline}
                onChange={setDeadline}
                placeholder={t('deadline_placeholder')}
                variant="outlined"
            />

            {/* Turnstile invisible container */}
            <div ref={containerRef} />

            <UiButton
                type="submit"
                variant="filled"
                size="lg"
                disabled={loading}
                className="mt-2 w-full font-semibold"
            >
                {loading ? t('submitting') : t('submit')}
            </UiButton>
        </form>
    );
}
```

### 6.4. BriefDialog — адаптивний контейнер

Файл: `apps/web/src/features/agency/brief/BriefDialog.tsx`

Використовує `UiModal` (Крок 6.0b) — bottom sheet на mobile, centered modal на desktop. Responsive поведінка вбудована в `UiModalContent` через Tailwind breakpoints.

```typescript
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
    UiModal,
    UiModalTrigger,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import BriefForm from './BriefForm';

interface BriefDialogProps {
    children: React.ReactNode;
}

export default function BriefDialog({ children }: BriefDialogProps) {
    const t = useTranslations('brief_form');
    const [open, setOpen] = useState(false);

    return (
        <UiModal open={open} onOpenChange={setOpen}>
            <UiModalTrigger asChild>
                {children}
            </UiModalTrigger>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>{t('title')}</UiModalTitle>
                </UiModalHeader>
                <div className="px-4 pb-6">
                    <BriefForm onSuccess={() => setOpen(false)} />
                </div>
            </UiModalContent>
        </UiModal>
    );
}
```

---

## Крок 7: Frontend — інтеграція CTA

### 7.1. HeroSection

Файл: `apps/web/src/widgets/agency/landing/HeroSection/HeroSection.tsx`

Обгорнути primary CTA в `BriefDialog`:

```tsx
import BriefDialog from '@/features/agency/brief/BriefDialog';

// Замінити existing primary CTA:
<BriefDialog>
    <UiButton
        variant="filled"
        size="lg"
        className="w-full font-semibold sm:w-auto"
        IconRight={<ArrowRight />}
    >
        {t('cta_primary')}
    </UiButton>
</BriefDialog>
```

Видалити `as="a"` та `href="#pricing"` — кнопка тепер тригер діалогу.

### 7.2. FooterCtaSection

Файл: `apps/web/src/widgets/agency/landing/FooterCtaSection/FooterCtaSection.tsx`

Аналогічно:

```tsx
import BriefDialog from '@/features/agency/brief/BriefDialog';

// Замінити existing CTA:
<BriefDialog>
    <UiButton
        variant="filled"
        size="lg"
        className="mt-8 w-full font-semibold sm:w-auto"
        IconRight={<ArrowRight />}
    >
        {t('cta')}
    </UiButton>
</BriefDialog>
```

Видалити `as="a"` та `href="#"`.

---

## Крок 8: i18n — frontend translations

### 8.1. messages/en.json

Структура файлу вже містить `notifications` та `errors` як вкладені об'єкти:

```json
{
    "notifications": {
        "auth": { "magic_link_sent": "...", ... },
        "users": { "terms_accepted": "..." }
    },
    "errors": {
        "auth": { "unauthorized": "...", ... },
        "payments": { "already_subscribed": "...", ... },
        "generic": { "validation_error": "...", ... }
    }
}
```

**Додати `"brief_form"` як новий top-level ключ** (поруч з `landing_page`, `notifications`, тощо):

```json
"brief_form": {
    "title": "Submit Your Project Brief",
    "name_placeholder": "Your name",
    "email_placeholder": "Email address",
    "description_placeholder": "Describe your project idea, goals, and any technical requirements...",
    "budget_placeholder": "Select budget range",
    "budget_under_2500": "< $2,500 (Consulting only)",
    "budget_2500_5000": "$2,500 – $5,000",
    "budget_5000_10000": "$5,000 – $10,000",
    "budget_over_10000": "$10,000+",
    "deadline_placeholder": "Timeline (optional)",
    "deadline_asap": "ASAP",
    "deadline_1_3_months": "1–3 months",
    "deadline_flexible": "Flexible",
    "submit": "Submit Brief",
    "submitting": "Submitting...",
    "captcha_not_ready": "Security verification in progress. Please try again in a moment.",
    "validation_name": "Name is required",
    "validation_email": "Please enter a valid email address",
    "validation_description": "Please describe your project (at least 10 characters)",
    "validation_budget": "Please select a budget range"
}
```

**Merge `"agency"` key в існуючий `notifications` об'єкт** (поруч з `auth`, `users`):

```json
"notifications": {
    "auth": { ... },
    "users": { ... },
    "agency": {
        "brief_submitted": "Request submitted. We will respond within 24 hours."
    }
}
```

**Merge `"agency"` key в існуючий `errors` об'єкт** (поруч з `auth`, `payments`, `generic`):

```json
"errors": {
    "auth": { ... },
    "payments": { ... },
    "generic": { ... },
    "agency": {
        "captcha_failed": "Security verification failed. Please try again."
    }
}
```

### 8.2. messages/uk.json

Аналогічна структура. Merge за тим самим принципом.

**Новий top-level ключ `"brief_form"`:**

```json
"brief_form": {
    "title": "Відправити бриф проєкту",
    "name_placeholder": "Ваше ім'я",
    "email_placeholder": "Електронна пошта",
    "description_placeholder": "Опишіть ідею проєкту, цілі та технічні вимоги...",
    "budget_placeholder": "Оберіть діапазон бюджету",
    "budget_under_2500": "< $2,500 (Тільки консультація)",
    "budget_2500_5000": "$2,500 – $5,000",
    "budget_5000_10000": "$5,000 – $10,000",
    "budget_over_10000": "$10,000+",
    "deadline_placeholder": "Терміни (опціонально)",
    "deadline_asap": "Якомога швидше",
    "deadline_1_3_months": "1–3 місяці",
    "deadline_flexible": "Гнучко",
    "submit": "Надіслати бриф",
    "submitting": "Надсилаємо...",
    "captcha_not_ready": "Перевірка безпеки в процесі. Спробуйте через мить.",
    "validation_name": "Введіть ваше ім'я",
    "validation_email": "Введіть коректну електронну адресу",
    "validation_description": "Опишіть ваш проєкт (мінімум 10 символів)",
    "validation_budget": "Оберіть діапазон бюджету"
}
```

**Merge в існуючий `"notifications"`:**

```json
"agency": {
    "brief_submitted": "Запит надіслано. Ми відповімо протягом 24 годин."
}
```

**Merge в існуючий `"errors"`:**

```json
"agency": {
    "captcha_failed": "Перевірка безпеки не пройдена. Спробуйте ще раз."
}
```

---

## Крок 9: Тести

### 9.1. API — BriefService unit test

Файл: `apps/api/src/modules/agency/services/brief.service.spec.ts`

Mock: `briefModel.create`, `emailService.sendBriefConfirmation`, `emailService.sendBriefNotification`.

Кейси:
- Brief зберігається з правильними полями та статусом `new`
- Обидва email методи викликаються з правильними параметрами
- Brief зберігається навіть якщо email fail (Promise.allSettled)

### 9.2. API — TurnstileService unit test

Файл: `apps/api/src/modules/agency/services/turnstile.service.spec.ts`

Mock: global `fetch`.

Кейси:
- Success: fetch повертає `{ success: true }` → не кидає exception
- Failure: fetch повертає `{ success: false }` → кидає BadRequestException з CAPTCHA_FAILED
- Передає `remoteip` якщо надано

### 9.3. API — BriefController unit test

Файл: `apps/api/src/modules/agency/brief.controller.spec.ts`

Mock: `turnstileService.verify`, `briefService.submit`.

Кейси:
- Turnstile верифікується ПЕРЕД submit
- Turnstile failure → submit не викликається
- Success → повертає `{ data: null, code: BRIEF_SUBMITTED }`

### 9.4. Web — BriefForm test

Файл: `apps/web/src/features/agency/brief/BriefForm.test.tsx`

Mock: `submitBrief`, `useTurnstile`, `next-intl`.

Кейси:
- Форма рендерить всі поля
- Submit disabled без Turnstile token
- Client validation показує errors
- Success toast + `onSuccess` callback

### 9.5. Web — source utility test

Файл: `apps/web/src/features/agency/brief/lib/source.test.ts`

Кейси:
- UTM parameter detected
- Referrer parsed correctly
- Direct fallback
- sessionStorage caching

---

## Крок 10: Верифікація

```bash
pnpm --filter @cyanship/types build
pnpm lint
pnpm --filter api test
pnpm --filter web test
pnpm build
```

---

## Фінальна структура файлів

```
packages/types/src/
├── validation/common.ts              # ОНОВИТИ: +nameSchema (shared validation primitive)
├── contracts/users.ts                # ОНОВИТИ: використати nameSchema замість inline regex
└── agency/
    ├── index.ts                      # ОНОВИТИ: export brief
    └── brief.ts                      # NEW: enums, Zod schema, types (uses nameSchema)

apps/api/src/
├── config/env.ts                     # ОНОВИТИ: +TURNSTILE_SECRET_KEY, +BRIEF_NOTIFICATION_EMAIL
├── test-setup.ts                     # ОНОВИТИ: +placeholder env vars
├── app.module.ts                     # ОНОВИТИ: +AgencyModule import
└── modules/
    ├── agency/
    │   ├── agency.module.ts          # NEW
    │   ├── brief.controller.ts       # NEW
    │   ├── brief.controller.spec.ts  # NEW
    │   ├── dto/
    │   │   └── submit-brief.dto.ts   # NEW
    │   ├── schemas/
    │   │   └── brief.schema.ts       # NEW
    │   └── services/
    │       ├── brief.service.ts      # NEW
    │       ├── brief.service.spec.ts # NEW
    │       ├── turnstile.service.ts  # NEW
    │       └── turnstile.service.spec.ts # NEW
    └── email/
        ├── email.service.ts          # ОНОВИТИ: +sendBriefConfirmation, +sendBriefNotification
        ├── i18n/
        │   ├── types.ts             # ОНОВИТИ: +BriefConfirmationTranslations
        │   ├── en.ts                # ОНОВИТИ: +briefConfirmation
        │   └── uk.ts                # ОНОВИТИ: +briefConfirmation
        └── templates/
            ├── brief-confirmation.tsx  # NEW
            └── brief-notification.tsx  # NEW

apps/web/src/
├── shared/
│   ├── config/env.ts                # ОНОВИТИ: +NEXT_PUBLIC_TURNSTILE_SITE_KEY
│   ├── api/agency.ts               # NEW
│   └── ui/
│       ├── UiTextarea/              # NEW: textarea primitive
│       │   ├── UiTextarea.tsx
│       │   ├── types.ts
│       │   └── index.ts
│       └── UiModal/                 # NEW: responsive modal (bottom sheet mobile, centered desktop)
│           ├── UiModal.tsx
│           ├── types.ts
│           └── index.ts
├── features/agency/brief/
│   ├── BriefForm.tsx                # NEW
│   ├── BriefForm.test.tsx           # NEW
│   ├── BriefDialog.tsx              # NEW
│   ├── index.ts                     # NEW: barrel export
│   └── lib/
│       ├── source.ts               # NEW
│       ├── source.test.ts          # NEW
│       └── useTurnstile.ts         # NEW
├── widgets/agency/landing/
│   ├── HeroSection/HeroSection.tsx  # ОНОВИТИ: CTA → BriefDialog trigger
│   └── FooterCtaSection/FooterCtaSection.tsx # ОНОВИТИ: CTA → BriefDialog trigger
└── messages/
    ├── en.json                      # ОНОВИТИ: +brief_form, merge agency в notifications та errors
    └── uk.json                      # ОНОВИТИ: +brief_form, merge agency в notifications та errors

docs/conventions/ui-primitives.md    # ОНОВИТИ: +UiTextarea, +UiModal в реєстрі
.env.example                         # ОНОВИТИ: +TURNSTILE_*, +BRIEF_NOTIFICATION_EMAIL
```

---

## Порядок виконання (залежності)

```
Крок 1 (types) ──────────────┐
                              ├──→ Крок 2 (API module) ──→ Крок 3 (email templates) ──→ Крок 4 (env vars)
                              │
Крок 6.0a (UiTextarea) ──┐   │
Крок 6.0b (UiModal) ─────┤   │
                          └───┴──→ Крок 5 (source) ──→ Крок 6 (BriefForm) ──→ Крок 7 (CTA) ──→ Крок 8 (i18n)
                                                                                                     │
                                                                                      Крок 9 (tests) ←┘
                                                                                                     │
                                                                                      Крок 10 (verify) ←┘
```

- Кроки 2-4 (backend) та 5-8 (frontend) можуть виконуватись **паралельно** після Кроку 1
- Кроки 6.0a/6.0b (UI primitives) не залежать від типів — можуть виконуватись **паралельно** з Кроком 1
- Крок 6 (BriefForm) залежить від: Крок 1 (types) + Крок 5 (source) + Крок 6.0a/6.0b (UI primitives)

---

## Чеклист якості

- [ ] Жодних env vars з default values (fail-fast policy)
- [ ] Zod schema shared між frontend і backend (single source of truth)
- [ ] Email templates використовують `EMAIL_COLORS` та `BaseLayout`
- [ ] i18n translations present в обох мовах (en, uk)
- [ ] Response codes зареєстровані в `RESPONSE_CODE` та `RESPONSE_CODE_TYPE`
- [ ] Frontend i18n keys відповідають конвенції `tone.md` (past tense, no emojis)
- [ ] Agency код не імпортується core модулями
- [ ] UiModal використовує theme tokens, не hardcoded кольори (design-tokens.md)
- [ ] UI елементи — тільки Ui* компоненти (ui-primitives.md), включно з UiTextarea та UiModal
- [ ] `docs/conventions/ui-primitives.md` оновлений: додано UiTextarea та UiModal до реєстру
- [ ] Turnstile token верифікується на сервері перед збереженням
- [ ] Email failures не блокують brief submission (Promise.allSettled)
- [ ] Source tracking кешується в sessionStorage, referrer зберігається як повний домен без маппінгу
- [ ] `nameSchema` — shared primitive, використовується і в `UpdateProfileSchema`, і в `SubmitBriefSchema`
- [ ] Error handling у формі використовує `AxiosError` type guard (не unsafe cast)
- [ ] i18n merge: `agency` key додано в існуючі `notifications` та `errors` об'єкти, не перезаписано
- [ ] Unit тести покривають: service, controller, turnstile, form, source utility
