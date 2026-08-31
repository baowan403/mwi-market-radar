declare function GM_getValue<T>(key: string, defaultValue: T): T;
declare function GM_getValue<T = unknown>(key: string): T | undefined;
declare function GM_setValue<T>(key: string, value: T): void;
declare function GM_deleteValue(key: string): void;
declare function GM_listValues(): string[];
