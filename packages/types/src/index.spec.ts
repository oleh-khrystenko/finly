import { emailSchema, firstNameSchema, lastNameSchema, nameSchema } from './index';

describe('@finly/types toolchain', () => {
    it('exposes shared validation schemas through the package entrypoint', () => {
        expect(nameSchema).toBeDefined();
        expect(firstNameSchema).toBeDefined();
        expect(lastNameSchema).toBeDefined();
        expect(emailSchema).toBeDefined();
    });

    it('runs Zod refinements through the ts-jest pipeline', () => {
        expect(nameSchema.safeParse('Іван').success).toBe(true);
        expect(nameSchema.safeParse('').success).toBe(false);
        expect(emailSchema.safeParse('user@finly.com.ua').success).toBe(true);
        expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    });
});
