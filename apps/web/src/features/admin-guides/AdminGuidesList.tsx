'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
    Plus,
    FileText,
    AlertCircle,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    Search,
} from 'lucide-react';
import type { AdminGuideListItem, GuideStatus } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiChipGroup from '@/shared/ui/UiChipGroup';
import {
    adminListGuides,
    reorderGuides,
    syncOrganicGuides,
} from '@/shared/api';

import { FieldHint } from './FieldHint';
import { GuideStatusBadge } from './GuideStatusBadge';

const DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
});

type LoadState = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready' };

/** Основний гайд (pillar) з його розділами (cluster-ами) — дерево /guides. */
interface GuideGroup {
    pillar: AdminGuideListItem;
    clusters: AdminGuideListItem[];
}

const TAB_ORDER: GuideStatus[] = ['planned', 'draft', 'published'];

const TAB_LABEL: Record<GuideStatus, string> = {
    planned: 'Заплановані',
    draft: 'Чернетки',
    published: 'Опубліковані',
};

const kindLabel = (item: AdminGuideListItem): string =>
    item.pillarSlug === null ? 'Основний гайд' : 'Розділ';

/**
 * Групує (вже впорядкований за `order`) список у дерево: основні гайди і
 * вкладені розділи. Осиротілі розділи (pillar відсутній серед переданих —
 * напр. на табі «Опубліковані» pillar ще чернетка) виносяться окремо, щоб
 * їхні id не випали з reorder-послідовності.
 */
function buildGroups(items: AdminGuideListItem[]): {
    groups: GuideGroup[];
    orphans: AdminGuideListItem[];
} {
    const groups: GuideGroup[] = items
        .filter((i) => i.pillarSlug === null)
        .map((pillar) => ({
            pillar,
            clusters: items.filter((i) => i.pillarSlug === pillar.slug),
        }));

    const placed = new Set<string>();
    for (const g of groups) {
        placed.add(g.pillar.id);
        for (const c of g.clusters) placed.add(c.id);
    }
    const orphans = items.filter((i) => !placed.has(i.id));

    return { groups, orphans };
}

function flatten(
    groups: GuideGroup[],
    orphans: AdminGuideListItem[]
): AdminGuideListItem[] {
    return [...groups.flatMap((g) => [g.pillar, ...g.clusters]), ...orphans];
}

function swap<T>(arr: T[], i: number, j: number): T[] {
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
}

/** Замінює підпослідовність (published-елементи) новим порядком, решту лишає. */
function replacePublished(
    items: AdminGuideListItem[],
    newPublished: AdminGuideListItem[]
): AdminGuideListItem[] {
    const queue = [...newPublished];
    return items.map((it) =>
        it.status === 'published' ? (queue.shift() ?? it) : it
    );
}

export function AdminGuidesList() {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });
    const [items, setItems] = useState<AdminGuideListItem[]>([]);
    const [tab, setTab] = useState<GuideStatus>('planned');
    const [savingOrder, setSavingOrder] = useState(false);
    const [syncingOrganic, setSyncingOrganic] = useState(false);
    // id основних гайдів, чиї розділи згорнуто (порожньо = всі розгорнуті).
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    useEffect(() => {
        let active = true;
        adminListGuides()
            .then((loaded) => {
                if (!active) return;
                setItems(loaded);
                // Стартовий таб — перший непорожній у порядку конвеєра.
                const firstNonEmpty = TAB_ORDER.find((s) =>
                    loaded.some((g) => g.status === s)
                );
                setTab(firstNonEmpty ?? 'planned');
                setState({ phase: 'ready' });
            })
            .catch(() => {
                if (active) setState({ phase: 'error' });
            });
        return () => {
            active = false;
        };
    }, []);

    const handleSyncOrganic = async () => {
        setSyncingOrganic(true);
        try {
            const result = await syncOrganicGuides();
            const fresh = await adminListGuides();
            setItems(fresh);
            toast.success(
                `Органіку оновлено: ${result.totalClicks} кліків за 28 днів`
            );
        } catch {
            toast.error('Не вдалося оновити органіку. Спробуйте пізніше.');
        } finally {
            setSyncingOrganic(false);
        }
    };

    const toggleCollapsed = (pillarId: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(pillarId)) next.delete(pillarId);
            else next.add(pillarId);
            return next;
        });
    };

    // Оптимістично міняємо порядок локально, потім зберігаємо. При помилці
    // відкочуємо до попереднього стану, щоб UI не розійшовся з базою.
    const persistOrder = async (next: AdminGuideListItem[]) => {
        const previous = items;
        setItems(next);
        setSavingOrder(true);
        try {
            await reorderGuides(next.map((i) => i.id));
        } catch {
            setItems(previous);
            toast.error('Не вдалося зберегти порядок. Спробуйте ще раз.');
        } finally {
            setSavingOrder(false);
        }
    };

    const published = items.filter((i) => i.status === 'published');

    const movePillar = (pillarIndex: number, dir: -1 | 1) => {
        const { groups, orphans } = buildGroups(published);
        const target = pillarIndex + dir;
        if (target < 0 || target >= groups.length) return;
        const next = flatten(swap(groups, pillarIndex, target), orphans);
        void persistOrder(replacePublished(items, next));
    };

    const moveCluster = (
        pillarIndex: number,
        clusterIndex: number,
        dir: -1 | 1
    ) => {
        const { groups, orphans } = buildGroups(published);
        const group = groups[pillarIndex];
        const target = clusterIndex + dir;
        if (target < 0 || target >= group.clusters.length) return;
        const nextGroups = groups.map((g, idx) =>
            idx === pillarIndex
                ? { ...g, clusters: swap(g.clusters, clusterIndex, target) }
                : g
        );
        const next = flatten(nextGroups, orphans);
        void persistOrder(replacePublished(items, next));
    };

    const counts: Record<GuideStatus, number> = {
        planned: 0,
        draft: 0,
        published: 0,
    };
    for (const it of items) counts[it.status] += 1;

    return (
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                        Гайди
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Керування статтями розділу гайдів.
                    </p>
                </div>
                <UiButton
                    as="link"
                    href="/admin/guides/new"
                    variant="filled"
                    size="md"
                    IconLeft={<Plus className="size-4" />}
                >
                    Нова тема
                </UiButton>
            </header>

            <div className="mt-8">
                {state.phase === 'loading' && (
                    <div className="flex justify-center py-16">
                        <UiSpinner size="lg" />
                    </div>
                )}

                {state.phase === 'error' && (
                    <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-3 rounded-xl border p-5 text-sm">
                        <AlertCircle className="size-5 shrink-0" aria-hidden />
                        Не вдалося завантажити список. Перезавантажте сторінку.
                    </div>
                )}

                {state.phase === 'ready' && items.length === 0 && (
                    <div className="border-border bg-muted/40 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                        <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                            <FileText className="size-5" aria-hidden />
                        </span>
                        <p className="text-foreground text-sm font-medium">
                            Гайдів ще немає
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Додайте першу тему, щоб почати наповнювати розділ.
                        </p>
                    </div>
                )}

                {state.phase === 'ready' && items.length > 0 && (
                    <>
                        <UiChipGroup
                            options={TAB_ORDER.map((s) => ({
                                value: s,
                                label: (
                                    <span className="flex items-center gap-2">
                                        {TAB_LABEL[s]}
                                        <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs font-medium">
                                            {counts[s]}
                                        </span>
                                    </span>
                                ),
                            }))}
                            value={tab}
                            onChange={(v) => setTab(v as GuideStatus)}
                        />

                        <div className="mt-5">
                            <TabHint tab={tab} />

                            <div className="mt-4">
                                {tab === 'published' ? (
                                    <div className="space-y-3">
                                        <div className="flex justify-end">
                                            <UiButton
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                loading={syncingOrganic}
                                                IconLeft={
                                                    <RefreshCw className="size-4" />
                                                }
                                                onClick={handleSyncOrganic}
                                            >
                                                Оновити з пошуку
                                            </UiButton>
                                        </div>
                                        <PublishedList
                                            published={published}
                                            collapsed={collapsed}
                                            savingOrder={savingOrder}
                                            onToggle={toggleCollapsed}
                                            onMovePillar={movePillar}
                                            onMoveCluster={moveCluster}
                                        />
                                    </div>
                                ) : (
                                    <FlatList
                                        items={items.filter(
                                            (i) => i.status === tab
                                        )}
                                        emptyText={
                                            tab === 'planned'
                                                ? 'Запланованих тем немає. Додайте нову тему кнопкою вгорі.'
                                                : 'Чернеток немає.'
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}

function TabHint({ tab }: { tab: GuideStatus }) {
    if (tab === 'planned') {
        return (
            <FieldHint>
                <p>
                    Список майбутніх статей, які ще не почали писати. Це ваш
                    чекліст тем: тут стаття це поки лише назва (за бажанням
                    нотатка про запит і основний гайд).
                </p>
                <p>
                    Коли сідаєте писати, відкрийте тему і натисніть «Перенести в
                    чернетки».
                </p>
            </FieldHint>
        );
    }
    if (tab === 'draft') {
        return (
            <FieldHint>
                <p>
                    Статті, які ви вже пишете, але ще не показуєте читачам. Їх
                    видно тільки тут, у пошуку їх немає.
                </p>
                <p>Коли текст готовий, публікуєте.</p>
            </FieldHint>
        );
    }
    return (
        <FieldHint>
            <p>
                Статті, які зараз видно на сайті і в пошуку. Стрілками задаєте
                порядок, у якому вони стоять на сторінці гайдів: основні гайди
                рухаються між собою (кожен разом зі своїми розділами), а
                розділи, лише всередині свого гайда. Порядок зберігається
                одразу.
            </p>
            <p>
                Біля кожної статті видно, скільки разів на неї перейшли з пошуку
                Google за останні 28 днів. Кнопка «Оновити з пошуку» підтягує
                свіжі числа (дані Google відстають на 2 дні, тож нові статті
                якийсь час показують нуль, це нормально).
            </p>
        </FieldHint>
    );
}

function FlatList({
    items,
    emptyText,
}: {
    items: AdminGuideListItem[];
    emptyText: string;
}) {
    if (items.length === 0) {
        return (
            <p className="text-muted-foreground border-border bg-muted/30 rounded-xl border border-dashed p-6 text-center text-sm">
                {emptyText}
            </p>
        );
    }
    return (
        <div className="space-y-2">
            {items.map((item) => (
                <div
                    key={item.id}
                    className="border-border bg-card flex items-start gap-2 rounded-xl border p-4"
                >
                    <GuideCardLink item={item} kind={kindLabel(item)} />
                </div>
            ))}
        </div>
    );
}

interface PublishedListProps {
    published: AdminGuideListItem[];
    collapsed: Set<string>;
    savingOrder: boolean;
    onToggle: (pillarId: string) => void;
    onMovePillar: (pillarIndex: number, dir: -1 | 1) => void;
    onMoveCluster: (
        pillarIndex: number,
        clusterIndex: number,
        dir: -1 | 1
    ) => void;
}

function PublishedList({
    published,
    collapsed,
    savingOrder,
    onToggle,
    onMovePillar,
    onMoveCluster,
}: PublishedListProps) {
    const { groups, orphans } = buildGroups(published);

    if (published.length === 0) {
        return (
            <p className="text-muted-foreground border-border bg-muted/30 rounded-xl border border-dashed p-6 text-center text-sm">
                Опублікованих статей немає.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            {groups.map((group, pillarIndex) => {
                const hasClusters = group.clusters.length > 0;
                const expanded = !collapsed.has(group.pillar.id);
                return (
                    <div key={group.pillar.id}>
                        <GuideRow
                            item={group.pillar}
                            kind="Основний гайд"
                            leading={
                                hasClusters ? (
                                    <UiButton
                                        type="button"
                                        variant="icon"
                                        size="md"
                                        aria-label={
                                            expanded
                                                ? 'Сховати розділи'
                                                : 'Показати розділи'
                                        }
                                        aria-expanded={expanded}
                                        onClick={() =>
                                            onToggle(group.pillar.id)
                                        }
                                    >
                                        <ChevronRight
                                            className={`size-5 transition-transform duration-200 ${
                                                expanded ? 'rotate-90' : ''
                                            }`}
                                        />
                                    </UiButton>
                                ) : (
                                    <span
                                        className="size-11 shrink-0"
                                        aria-hidden
                                    />
                                )
                            }
                            upDisabled={pillarIndex === 0 || savingOrder}
                            downDisabled={
                                pillarIndex === groups.length - 1 || savingOrder
                            }
                            onUp={() => onMovePillar(pillarIndex, -1)}
                            onDown={() => onMovePillar(pillarIndex, 1)}
                        />
                        {hasClusters && (
                            <div
                                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                                    expanded
                                        ? 'grid-rows-[1fr]'
                                        : 'grid-rows-[0fr]'
                                }`}
                            >
                                <div className="overflow-hidden">
                                    <div className="space-y-2 pt-2 pl-5 sm:pl-10">
                                        {group.clusters.map(
                                            (cluster, clusterIndex) => (
                                                <GuideRow
                                                    key={cluster.id}
                                                    item={cluster}
                                                    kind="Розділ"
                                                    upDisabled={
                                                        clusterIndex === 0 ||
                                                        savingOrder
                                                    }
                                                    downDisabled={
                                                        clusterIndex ===
                                                            group.clusters
                                                                .length -
                                                                1 || savingOrder
                                                    }
                                                    onUp={() =>
                                                        onMoveCluster(
                                                            pillarIndex,
                                                            clusterIndex,
                                                            -1
                                                        )
                                                    }
                                                    onDown={() =>
                                                        onMoveCluster(
                                                            pillarIndex,
                                                            clusterIndex,
                                                            1
                                                        )
                                                    }
                                                />
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Опублікований розділ, чий основний гайд ще не опубліковано:
                показуємо, але без перестановки (немає групи-дому). */}
            {orphans.map((item) => (
                <div
                    key={item.id}
                    className="border-border bg-card flex items-start gap-2 rounded-xl border p-4"
                >
                    <GuideCardLink
                        item={item}
                        kind="Розділ (основний гайд не опубліковано)"
                        showOrganic
                    />
                </div>
            ))}
        </div>
    );
}

function GuideCardLink({
    item,
    kind,
    showOrganic = false,
}: {
    item: AdminGuideListItem;
    kind: string;
    showOrganic?: boolean;
}) {
    return (
        <UiLink
            as="link"
            href={`/admin/guides/${item.id}`}
            variant="unstyled"
            className="group hover:text-primary min-w-0 flex-1 transition-colors"
        >
            <div className="flex items-center gap-2">
                <p className="text-foreground group-hover:text-primary truncate font-medium transition-colors">
                    {item.title}
                </p>
                <GuideStatusBadge status={item.status} />
            </div>
            <p className="text-muted-foreground mt-1 truncate text-sm">
                /{item.slug}
            </p>
            <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>{kind}</span>
                <span aria-hidden>·</span>
                <span>
                    Оновлено {DATE_FMT.format(new Date(item.updatedAt))}
                </span>
                {showOrganic && (
                    <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                            <Search className="size-3" aria-hidden />
                            {item.organicSyncedAt === null
                                ? 'органіка ще не оновлена'
                                : `${item.organicClicks} з пошуку за 28 днів`}
                        </span>
                    </>
                )}
            </div>
        </UiLink>
    );
}

interface GuideRowProps {
    item: AdminGuideListItem;
    kind: string;
    /** Керуючий елемент перед назвою (акордеон-перемикач для основних гайдів). */
    leading?: ReactNode;
    upDisabled: boolean;
    downDisabled: boolean;
    onUp: () => void;
    onDown: () => void;
}

function GuideRow({
    item,
    kind,
    leading,
    upDisabled,
    downDisabled,
    onUp,
    onDown,
}: GuideRowProps) {
    return (
        <div className="border-border bg-card flex items-start gap-2 rounded-xl border p-4">
            {leading}
            <GuideCardLink item={item} kind={kind} showOrganic />
            <div className="flex shrink-0 items-center gap-1">
                <UiButton
                    type="button"
                    variant="icon"
                    size="sm"
                    aria-label="Підняти вище"
                    disabled={upDisabled}
                    onClick={onUp}
                >
                    <ChevronUp className="size-4" />
                </UiButton>
                <UiButton
                    type="button"
                    variant="icon"
                    size="sm"
                    aria-label="Опустити нижче"
                    disabled={downDisabled}
                    onClick={onDown}
                >
                    <ChevronDown className="size-4" />
                </UiButton>
            </div>
        </div>
    );
}
