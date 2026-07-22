/**
 * Sprint 29 — маркери підстановки у шаблоні призначення платежу.
 *
 * Системний отримувач (податкова, фонди) зберігає призначення з маркерами
 * (`Єдиний внесок {taxId} за {period}`). Публічна сторінка такого отримувача
 * рендерить форму з полями під знайдені маркери і підставляє значення у
 * призначення перед генерацією QR (сама персоналізація — окремий зріз спринту).
 *
 * Маркери дозволені ЛИШЕ у шаблонах системних отримувачів (`Business.isSystem`).
 * Звичайний платник їх не приймає: інакше його публічна сторінка рендерила б
 * несподівану форму підстановки замість готового QR.
 *
 * Токен маркера — `{name}` латиницею. Дужки `{` `}` входять у NBU-charset
 * (ASCII 0x7B/0x7D), тож шаблон з маркерами проходить charset-валідацію; за
 * персоналізації маркер замінюється на реальне значення до збірки payload.
 */

import { effectiveLimit, isWithinByteLimit } from '../qr/limits';

const PURPOSE_LIMIT = effectiveLimit('purpose');

export const PURPOSE_MARKERS = ['taxId', 'fullName', 'period'] as const;

export type PurposeMarker = (typeof PURPOSE_MARKERS)[number];

const KNOWN_MARKERS = new Set<string>(PURPOSE_MARKERS);

/** Токен-форма маркера для вставки у шаблон: `taxId` → `{taxId}`. */
export function purposeMarkerToken(marker: PurposeMarker): string {
    return `{${marker}}`;
}

// Будь-яка пара дужок з довільним вмістом без вкладених дужок. Навмисно ШИРШЕ
// за набір валідних імен: розрізнення відомий/невідомий робить caller, а все, що
// схоже на маркер, мусить бути ним або явною помилкою валідації. Вузький
// `[A-Za-z]+` тихо пропускав би «мертві» токени — `{ taxId }` з пробілами,
// `{tax_id}`, `{taxId2}` не матчились узагалі, тож `findUnknownPurposeMarkers`
// повертав порожньо, шаблон зберігався, форма підстановки поля не рендерила, і
// літеральний `{ taxId }` їхав у призначення податкового платежу.
const MARKER_TOKEN_PATTERN = /\{([^{}]*)\}/g;

function extractMarkerNames(template: string): string[] {
    const names: string[] = [];
    for (const match of template.matchAll(MARKER_TOKEN_PATTERN)) {
        names.push(match[1]!);
    }
    return names;
}

/** Відомі маркери у порядку появи (з повторами) — для рендеру форми підстановки. */
export function findKnownPurposeMarkers(template: string): PurposeMarker[] {
    return extractMarkerNames(template).filter((name): name is PurposeMarker =>
        KNOWN_MARKERS.has(name)
    );
}

/** Чи містить шаблон хоч один ВІДОМИЙ маркер підстановки. */
export function containsPurposeMarker(template: string): boolean {
    return findKnownPurposeMarkers(template).length > 0;
}

/** Токени `{word}`, яких немає у словнику маркерів — невалідні у системному шаблоні. */
export function findUnknownPurposeMarkers(template: string): string[] {
    return extractMarkerNames(template).filter(
        (name) => !KNOWN_MARKERS.has(name)
    );
}

/** Унікальні відомі маркери шаблону (без повторів), для рендеру полів форми. */
export function uniquePurposeMarkers(template: string): PurposeMarker[] {
    return [...new Set(findKnownPurposeMarkers(template))];
}

/**
 * Підставляє надані значення на місце маркерів; ненадані лишає як є.
 *
 * Один прохід по шаблону, а не послідовна заміна маркер-за-маркером: дужки
 * `{` `}` входять у NBU-charset, тож значення поля може містити токен іншого
 * маркера (`Іван {period} Петренко` проходить валідацію ПІБ). Послідовна заміна
 * підставила б його вдруге, і призначення платежу мовчки відрізнялося б від
 * введеного платником.
 */
export function substitutePurposeMarkers(
    template: string,
    values: Partial<Record<PurposeMarker, string>>
): string {
    return template.replace(MARKER_TOKEN_PATTERN, (token, name: string) => {
        if (!KNOWN_MARKERS.has(name)) {
            return token;
        }
        return values[name as PurposeMarker] ?? token;
    });
}

/**
 * Sprint 29 — персоналізоване призначення платежу з шаблону системного
 * отримувача. Перевіряє, що надано значення для кожного маркера шаблону, і
 * підставляє їх. Два режими провалу:
 *  - `incomplete` — маркери без значення (форму заповнено не повністю);
 *  - `too-long` — зібране призначення перевищує ліміт ПОЛЯ призначення. Пер-полеві
 *    ліміти значень (`personalizationFullNameZod` тощо) не компонуються з лімітом
 *    поля, тож довгий шаблон біля межі + максимальні значення дали б поле понад
 *    норматив.
 *
 * **Це не гарантія, що payload збереться.** Ліміт поля призначення (420 симв. /
 * 840 B) більший за весь бюджет payload (507 B), тож призначення в межах поля все
 * одно може переповнити QR разом з рештою полів. Загальний бюджет перевіряє
 * викликач пробним білдом (`assertPersonalizedPayloadFits` у
 * `PublicAccountsController`) — тут його порахувати нічим, бо решта полів payload
 * функції не видима.
 */
export function buildPersonalizedPurpose(
    template: string,
    values: Partial<Record<PurposeMarker, string>>
):
    | { ok: true; purpose: string }
    | { ok: false; reason: 'incomplete'; missing: PurposeMarker[] }
    | { ok: false; reason: 'too-long' } {
    const markers = uniquePurposeMarkers(template);
    const missing = markers.filter((marker) => {
        const value = values[marker];
        return value === undefined || value === '';
    });
    if (missing.length > 0) {
        return { ok: false, reason: 'incomplete', missing };
    }
    const purpose = substitutePurposeMarkers(template, values);
    if (
        purpose.length > PURPOSE_LIMIT.chars ||
        !isWithinByteLimit(purpose, PURPOSE_LIMIT.bytes)
    ) {
        return { ok: false, reason: 'too-long' };
    }
    return { ok: true, purpose };
}
