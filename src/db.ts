import { SQL } from "bun";
import { schema } from "./schema";
import { synchronizePostgres, synchronizeSQLite } from "./db/schema-sync";

export const databaseURL = process.env.DATABASE_URL ?? "postgres://dev@localhost:5432/xitter";
export const databaseBackend = /^(sqlite:|:memory:$)/.test(databaseURL) ? "sqlite" : "postgres";
if (databaseBackend === "postgres" && !/^postgres(?:ql)?:\/\//.test(databaseURL))
	throw new Error("DATABASE_URL must use postgres://, postgresql://, or sqlite://");
export const sqlitePath = databaseBackend === "sqlite" ? databaseURL.replace(/^sqlite:(?:\/\/)?/, "") : undefined;
if (sqlitePath === "") throw new Error("SQLite DATABASE_URL needs a filename (sqlite://data/xitter.sqlite) or :memory:");
const sqlite = sqlitePath === undefined ? undefined : (await import("./sqlite")).openSQLite(sqlitePath);
export const sql: SQL = (sqlite?.sql ??
	new SQL(databaseURL, {
		max: Number(process.env.DB_POOL_MAX ?? 20),
		connection: {
			statement_timeout: process.env.DB_STATEMENT_TIMEOUT ?? "30s",
			lock_timeout: process.env.DB_LOCK_TIMEOUT ?? "10s",
			idle_in_transaction_session_timeout: "60s",
			// No JIT: the feed queries' correlated subqueries push their estimated cost
			// far past the JIT threshold, and compiling them took seconds on every
			// call, several times longer than running them.
			jit: "off",
		},
	})) as SQL;

// Routine edits in schema.ts produce versioned upgrades for either backend.
export async function migrate() {
	if (sqlite) return sqlite.enqueue(() => synchronizeSQLite(sqlite, schema));
	await synchronizePostgres(sql, schema);
}

// VACUUM INTO makes a consistent standalone snapshot, including committed WAL data.
export async function snapshotSQLite(path: string) {
	if (!sqlite) throw new Error("Not a SQLite database");
	await sqlite.enqueue(() => sqlite.db.query("vacuum into ?").run(path));
}
export async function databaseBytes(): Promise<string> {
	if (sqlite)
		return sqlite.enqueue(() => {
			const pages = sqlite.db.query("pragma page_count").get() as any;
			const size = sqlite.db.query("pragma page_size").get() as any;
			return String(pages.page_count * size.page_size);
		});
	return (await sql`select pg_database_size(current_database())::text as bytes`)[0].bytes;
}
