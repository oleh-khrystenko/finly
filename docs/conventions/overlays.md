# Overlay Policy

> Всі overlay-компоненти (модалки, sheets, confirm dialogs) підпорядковуються єдиним правилам монтування, керування станом та вибору примітиву.

## Принцип

```
Trigger (кнопка, подія, store action)
        |
        v
   Zustand store   <-- єдине джерело стану overlay
        |
        v
   shared/ui/Ui*   <-- єдиний спосіб рендерити overlay
        |
        v
   Layout mount    <-- overlay монтується один раз у root layout
```

Overlay ніколи не монтується поруч із trigger. Trigger лише викликає `store.open()`.

## Реєстр overlay-примітивів

| Примітив          | Призначення                                                    | Radix база           |
| ----------------- | -------------------------------------------------------------- | -------------------- |
| `UiModal`         | Модалки з контентом (форми, деталі, wizard)                    | `react-dialog`       |
| `UiSheet`         | Бокові/нижні панелі (навігація, фільтри, мобільний контент)    | `react-dialog`       |
| `UiConfirmDialog` | Підтвердження дій (видалення, скидання, деструктивні операції) | `react-alert-dialog` |

## Rules

### 1. Тільки примітиви

Overlay за межами `shared/ui/` **завжди** використовує один із трьох примітивів. Рендер raw `<div>` з ручним backdrop, Escape-обробкою чи z-index — заборонений.

**Чому:** примітиви гарантують focus trap, scroll lock, accessibility (aria), анімації та консистентну поведінку. Ручна реалізація неминуче пропускає edge cases.

### 2. Стан через Zustand store, в межах власного slice

Кожен overlay керується через виділений Zustand store, який живе **усередині того slice, що володіє overlay**. Глобального `src/stores/` каталогу не існує — це enforced ESLint правилом `no-restricted-imports` (`apps/web/eslint.config.mjs`).

```
features/{domain}/
  {Name}Dialog.tsx          # overlay компонент
  {name}DialogStore.ts      # Zustand store: isOpen, open(), close(), optional payload
```

Аналогічно для widget-owned overlay'їв store лежить у `widgets/{name}/` поруч з компонентом.

Store може містити payload для параметризації overlay (наприклад, ID сутності для підтвердження видалення, режим відкриття).

**Заборонено:**

- `useState` для стану overlay
- `renderWrapper` / render prop патерни для передачі модалки через trigger
- Винесення overlay store у глобальний `src/stores/` каталог (lint-error)

**Чому:** єдиний патерн для всіх overlay — передбачуваний, тестований, масштабований. In-slice ownership гарантує, що видалення фічі не залишає orphan-state у глобальному каталозі.

### 3. Один overlay — один mount через `app/overlays.tsx`

Всі overlay монтуються через єдиний реєстр — `app/overlays.tsx`, який рендериться один раз у root layout. Lazy-завантаження вирішується через `dynamic(() => import(...))` на рівні реєстру.

**Заборонено:** монтувати overlay в секційних layout'ах, монтувати один overlay в кількох місцях, обгортати trigger компонентом overlay.

### 4. Вибір примітиву

| Сценарій                                             | Примітив          |
| ---------------------------------------------------- | ----------------- |
| Форма, wizard, деталі сутності, складний контент     | `UiModal`         |
| Підтвердження дії (1 питання → confirm/cancel)       | `UiConfirmDialog` |
| Навігація, фільтри, мобільний контент, бокова панель | `UiSheet`         |

Якщо overlay починається як confirm, але потребує форму (наприклад, введення пароля для підтвердження) — використовуй `UiModal`, не `UiConfirmDialog`.

### 5. Структура feature-level overlay

```
features/{domain}/
  {Name}Dialog.tsx          # компонент overlay, читає store
  {name}DialogStore.ts      # Zustand store (in-slice)
  index.ts                  # public API: експортує лише те, що потрібно ззовні
```

Overlay-компонент:

- Читає `isOpen` та `close` зі store через **relative import** (`./{name}DialogStore`)
- Не приймає `children` і не рендерить trigger
- Містить весь контент overlay (або делегує internal-компонентам feature)

**Внутрішньо-slice'ові споживачі** (в тому ж каталозі feature) — використовують relative import. **Зовнішні споживачі того ж модуля** (інша feature/widget) можуть імпортувати через барель `@/features/{domain}` — але тільки якщо store експортовано там явно. Не експортуй store з барелю, якщо у нього немає external консьюмерів — менший public API краще.

### 6. Payload для параметризованих overlay

Коли overlay потребує контексту (ID сутності, варіант дії):

```ts
interface DeleteDialogState {
    isOpen: boolean;
    targetId: string | null;
    open: (id: string) => void;
    close: () => void;
}
```

Trigger викликає `open(id)`, overlay читає `targetId` зі store.

### 7. Заборона вкладених overlay

Overlay не може відкривати інший overlay. Якщо потрібна послідовність кроків — використовуй multi-step контент всередині одного overlay (wizard pattern), а не вкладені модалки.

## Приклад: правильна реалізація (in-slice ownership)

**Store (поруч з overlay компонентом):**

```ts
// features/profile/avatarUploadDialogStore.ts
import { create } from 'zustand';

export const useAvatarUploadDialogStore = create<AvatarUploadDialogState>(
    (set) => ({
        isOpen: false,
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    })
);
```

**Overlay компонент (relative import зі свого slice):**

```tsx
// features/profile/AvatarUploadDialog.tsx
import { useAvatarUploadDialogStore } from './avatarUploadDialogStore';

export default function AvatarUploadDialog() {
    const isOpen = useAvatarUploadDialogStore((s) => s.isOpen);
    const close = useAvatarUploadDialogStore((s) => s.close);

    return (
        <UiModal open={isOpen} onOpenChange={(open) => !open && close()}>
            <UiModalContent>...</UiModalContent>
        </UiModal>
    );
}
```

**Реєстрація в overlay registry (єдиний global mount point):**

```tsx
// app/overlays.tsx
const AvatarUploadDialog = dynamic(
    () => import('@/features/profile/AvatarUploadDialog')
);

export function Overlays() {
    return (
        <>
            <AvatarUploadDialog />
            {/* ... */}
        </>
    );
}
```

**Trigger зсередини того ж slice (профільна сторінка):**

```tsx
// app/[locale]/(protected)/profile/AvatarSection.tsx
import { useAvatarUploadDialogStore } from '@/features/profile/avatarUploadDialogStore';

const open = useAvatarUploadDialogStore((s) => s.open);
<UiButton onClick={open}>Upload avatar</UiButton>;
```

## Cross-slice триггер

Cross-slice triggers (коли overlay живе в одному slice, а trigger у зовсім іншому) зараз не використовуються. Якщо знадобиться — стандартний підхід: інверсія залежностей через event bus у `shared/lib/`, аналогічно до `authEvents`. Прямий імпорт store між незв'язаними slice'ами не використовується, щоб видалення/перестановка одного slice не ламала чужий код.
