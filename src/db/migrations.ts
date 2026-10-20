import type { Dialect } from "./schema-types";

// Add explicit, ordered upgrades here for renames, drops, and data transformations.
// IDs are immutable once released. Routine schema edits need no entry here.
export interface Migration {
	id: string;
	up: Record<Dialect, string[]>;
}
export const migrations: Migration[] = [
	{
		id: "002-post-received-at",
		up: {
			postgres: ["alter table posts add column if not exists received_at timestamptz", "update posts set received_at = created_at where received_at is null"],
			sqlite: ["alter table posts add column received_at timestamptz", "update posts set received_at = created_at where received_at is null"],
		},
	},
];
