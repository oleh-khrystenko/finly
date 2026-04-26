export const RESPONSE_TYPE = {
    SUCCESS: 'success',
    ERROR: 'error',
} as const;

export type ResponseType = (typeof RESPONSE_TYPE)[keyof typeof RESPONSE_TYPE];
