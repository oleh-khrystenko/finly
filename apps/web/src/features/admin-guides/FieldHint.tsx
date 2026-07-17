import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Сіра дрібна підказка під полем редактора гайдів. Написана максимально
 * простою мовою для автора, який не знає, як працює SEO: пояснює навіть
 * очевидне і уникає технічних термінів. Завжди видима (на відміну від
 * `description`-пропа полів, який ховається під час помилки), бо підказка
 * потрібна саме тоді, коли автор не певен, що вписати.
 *
 * 12px (text-xs) — свідомий виняток із 14px-мінімуму проєкту: це довгий
 * допоміжний текст, а не основна копія. Зліва інформаційна іконка, щоб блок
 * читався саме як підказка.
 *
 * Приклади синтаксису обгортайте в `<code>`, переліки — у `<ul><li>`:
 * стилі застосовуються автоматично.
 */
export function FieldHint({ children }: { children: ReactNode }) {
    return (
        <div className="text-muted-foreground mt-1.5 flex gap-1.5 text-xs leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-1.5 [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_strong]:text-foreground [&_strong]:font-medium [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
                {children}
            </div>
        </div>
    );
}
