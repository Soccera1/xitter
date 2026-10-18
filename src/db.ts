import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

// PostgreSQL uses an idempotent schema; SQLite tracks schema versions with user_version.
export async function migrate() {
	if (sqlite) {
		await sqlite.enqueue(() => {
			const version = Number((sqlite.db.query("pragma user_version").get() as any).user_version);
			if (version > 1) throw new Error("SQLite database was created by a newer version of Xitter");
			sqlite.db.exec("begin immediate");
			try {
				sqlite.db.exec(readFileSync(join(import.meta.dir, "schema.sqlite.sql"), "utf8"));
				sqlite.db.exec("pragma user_version = 1");
				sqlite.db.exec("commit");
			} catch (e) {
				sqlite.db.exec("rollback");
				throw e;
			}
		});
		return;
	}
	await sql.begin(async (tx) => {
		await tx`set local statement_timeout = 0`;
		await tx`set local lock_timeout = 0`;
		await tx.unsafe(readFileSync(join(import.meta.dir, "schema.sql"), "utf8"));
	});
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
