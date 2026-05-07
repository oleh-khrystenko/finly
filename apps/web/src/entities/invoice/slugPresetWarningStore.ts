import { create } from 'zustand';

/**
 * Sprint 4 §4.5 SP-1 + §4.4 — confirmation-modal store для `with-purpose`-
 * пресета. Власник: `entities/invoice` — privacy-warning стосується
 * domain-level правила слаг-пресета, тож живе на entity-шарі. І
 * `features/invoice-create` (форма створення), і `features/invoices`
 * (settings-section на сторінці бізнесу) консьюмлять це з нижчого FSD-
 * шару — без feature→feature coupling-у.
 *
 * **API.** `open(onConfirm, onCancel)` — caller передає **дві окремі callback-и**.
 *  - `onConfirm` — викликається коли user натиснув "Розумію, обираю".
 *  - `onCancel` — викликається коли user закрив modal будь-яким іншим способом
 *    (Cancel-кнопка, ESC, click-outside, programmatic `close()`).
 *
 * **Чому два callback-и, а не subscribe-on-`isOpen`.** Раніша версія тримала
 * лише `onConfirm` і caller subscribe-ив на `isOpen`-зміну, припускаючи що
 * `false` = cancel. Це race-prone: dialog при confirm робить
 * `onConfirm() → close()`, тож `isOpen=false`-event виникає **після**
 * виклику callback. Subscribe-ловець-cancel розглядав це як cancel і викликав
 * reject() — попри те, що actual-save вже стартував. Окремі callback-и
 * вбивають цей race детермінованим контрактом: dialog знає, що саме сталося,
 * і викликає правильну гілку.
 *
 * **Контракт з dialog-component-ом.** `confirm()` викликається з `onConfirm`-
 * handler-а UiConfirmDialog. `cancel()` — з `onOpenChange(false)`. Обидва
 * скидають state і викликають саме одну з callback-функцій (mutex-style:
 * якщо `confirm()` вже викликаний — `cancel()`-callback ігнорується).
 */
interface State {
    isOpen: boolean;
    onConfirm: (() => void) | null;
    onCancel: (() => void) | null;
    open: (onConfirm: () => void, onCancel: () => void) => void;
    confirm: () => void;
    cancel: () => void;
}

export const useSlugPresetWarningStore = create<State>((set, get) => ({
    isOpen: false,
    onConfirm: null,
    onCancel: null,
    open: (onConfirm, onCancel) =>
        set({ isOpen: true, onConfirm, onCancel }),
    confirm: () => {
        const cb = get().onConfirm;
        // Reset state BEFORE callback — щоб повторний open() усередині callback-а
        // (рідкісний edge-case) не загубив state.
        set({ isOpen: false, onConfirm: null, onCancel: null });
        cb?.();
    },
    cancel: () => {
        const cb = get().onCancel;
        set({ isOpen: false, onConfirm: null, onCancel: null });
        cb?.();
    },
}));
