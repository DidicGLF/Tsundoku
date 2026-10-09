export function cleanVersion(value: unknown): string | undefined;
export function versionFromDescribe(output: unknown): string | undefined;
export function versionCode(version: string): number;
export function appVersion(env?: Record<string, string | undefined>): string;
