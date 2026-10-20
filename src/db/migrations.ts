import type { Dialect } from "./schema-types";

// Add explicit, ordered upgrades here for renames, drops, and data transformations.
// IDs are immutable once released. Routine schema edits need no entry here.
export interface Migration {
	id: string;
	up: Record<Dialect, string[]>;
}
export const migrations: Migration[] = [];
