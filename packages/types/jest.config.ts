import type { Config } from 'jest';

const config: Config = {
    testEnvironment: 'node',
    rootDir: '.',
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.spec.json',
            },
        ],
    },
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
