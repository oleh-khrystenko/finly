import { slugifyPurpose } from './transliterate';

describe('slugifyPurpose', () => {
    it('базовий UA-input', () => {
        expect(slugifyPurpose('Оплата за консультацію')).toBe(
            'oplata-za-konsultatsiiu'
        );
    });

    it('typographic apostrophe U+2019 — drop (М’ясо → miaso)', () => {
        expect(slugifyPurpose('М’ясо')).toBe('miaso');
    });

    it('ASCII apostrophe — drop', () => {
        expect(slugifyPurpose("Кав'ярня")).toBe('kaviarnia');
    });

    it('numbers preserved', () => {
        expect(slugifyPurpose('Замовлення 147')).toBe('zamovlennia-147');
    });

    it('multiple spaces collapse to single dash', () => {
        expect(slugifyPurpose('Оплата    за    роботу')).toBe(
            'oplata-za-robotu'
        );
    });

    it('punctuation → dash → collapsed', () => {
        expect(slugifyPurpose('Оплата: за #1, № 2!')).toBe('oplata-za-1-2');
    });

    it('emoji-only input → empty', () => {
        expect(slugifyPurpose('🎉🎁')).toBe('');
    });

    it('whitespace-only → empty', () => {
        expect(slugifyPurpose('   ')).toBe('');
    });

    it('truncate до 60 chars', () => {
        const long = 'a'.repeat(100);
        const result = slugifyPurpose(long);
        expect(result).toHaveLength(60);
    });

    it('truncate без trailing dash', () => {
        // Якщо позиція 60 потрапляє після dash-у → trailing dash треба очистити.
        // Беремо рядок з 30 chars + dash + 30 chars так, щоб 60-та позиція = '-'.
        const tricky = `${'a'.repeat(60)}-after-truncate`;
        const result = slugifyPurpose(tricky);
        expect(result).toHaveLength(60);
        expect(result.endsWith('-')).toBe(false);
    });

    it('latin chars preserved', () => {
        expect(slugifyPurpose('Order #123 ABC')).toBe('order-123-abc');
    });

    it('mixed UA + latin', () => {
        expect(slugifyPurpose('Інвойс №42 Premium')).toBe('invois-42-premium');
    });

    it('edge: тільки 1 ASCII char', () => {
        expect(slugifyPurpose('a')).toBe('a');
    });

    it('edge: послідовні розділювачі — collapse', () => {
        expect(slugifyPurpose('a---b___c   d')).toBe('a-b-c-d');
    });

    it('щ → shch', () => {
        expect(slugifyPurpose('Щука')).toBe('shchuka');
    });

    it('х → kh', () => {
        expect(slugifyPurpose('Хата')).toBe('khata');
    });

    it('ь → drop (без подвоєння)', () => {
        expect(slugifyPurpose('День')).toBe('den');
    });

    it('російські safety-net символи (ё, ы, э, ъ)', () => {
        expect(slugifyPurpose('ёлка')).toBe('elka');
        expect(slugifyPurpose('сын')).toBe('syn');
        expect(slugifyPurpose('это')).toBe('eto');
        expect(slugifyPurpose('объект')).toBe('obekt');
    });
});
