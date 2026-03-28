declare module 'semver' {
    export class SemVer {
        constructor(version: string);
        format(): string;
    }

    export function coerce(version: string): SemVer | null;
    export function compare(left: SemVer | string, right: SemVer | string): number;
}
