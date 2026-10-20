import { afterAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "../src/schema";
import { openSQLite } from "../src/sqlite";
import { HISTORY, synchronizePostgres, synchronizeSQLite } from "../src/db/schema-sync";
import type { Schema } from "../src/db/schema-types";
import type { Migration } from "../src/db/migrations";

const directory = mkdtempSync(join(tmpdir(), "xitter-schema-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let serial = 0;
async function fixture(backend: "sqlite" | "postgres") {
	const n = ++serial;
	if (backend === "sqlite") {
		const connection = openSQLite(join(directory, `${n}.sqlite`));
		// Exercise adoption of a real deployed v1 file, not just a fresh target schema.
		connection.db.exec(readFileSync(join(import.meta.dir, "../src/db/migrations/sqlite/001-initial.sql"), "utf8"));
		connection.db.exec("pragma user_version = 1");
		return {
			sql: connection.sql as any,
			sync: async (next: Schema, upgrades: Migration[] = []) => synchronizeSQLite(connection, next, upgrades),
			close: async () => {
				await connection.sql.close();
			},
		};
	}
	const url = new URL(process.env.TEST_POSTGRES_URL!);
	const admin = new SQL(url.href),
		name = `xitter_schema_test_${process.pid}_${n}`;
	await admin.unsafe(`create database "${name}"`);
	url.pathname = `/${name}`;
	const sql = new SQL(url.href, { max: 1 });
	return {
		sql: sql as any,
		sync: (next: Schema, upgrades: Migration[] = []) => synchronizePostgres(sql, next, upgrades),
		close: async () => {
			await sql.close();
			await admin.unsafe(`drop database "${name}"`);
			await admin.close();
		},
	};
}
const history = (sql: any) => sql.unsafe(`select * from "${HISTORY}" order by version`);
const seed = (sql: any) => sql`insert into users(id,screen_name,name,password_hash,bio) values (123,'schema_user','Schema user','unused','preserve me')`;

for (const backend of ["sqlite", "postgres"] as const) {
	const run = backend === "postgres" && !process.env.TEST_POSTGRES_URL ? test.skip : test;
	run(
		`${backend}: v1 adoption and automatic additions preserve rows, keys, counters and views`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				await db.sql`insert into posts(id,user_id,text,conversation_id) values (456,123,'existing post',456)`;
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.sync_label = { type: "text", notNull: true, default: { value: "ready" } };
				next.tables.users.columns.sync_flags = { type: "json", default: { value: { enabled: true } } };
				next.tables.users.columns.sync_tags = { type: "text[]", default: { value: ["one", "two"] } };
				next.tables.users.columns.sync_at = { type: "timestamp", notNull: true, default: "now()" };
				next.tables.schema_examples = {
					columns: {
						id: { type: "bigint", primaryKey: true },
						user_id: { type: "bigint", notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } },
					},
				};
				next.indexes.users_sync_label_idx = { table: "users", expressions: ["sync_label"], where: "sync_label <> ''" };
				await db.sync(next);
				const [row] = await db.sql`select bio,sync_label,sync_at,sync_flags,sync_tags from users where id = 123`;
				expect(row.bio).toBe("preserve me");
				expect(row.sync_label).toBe("ready");
				expect(row.sync_at).toBeInstanceOf(Date);
				expect(row.sync_flags).toEqual({ enabled: true });
				expect(row.sync_tags).toEqual(["one", "two"]);
				expect((await db.sql`select posts from user_stats where user_id = 123`)[0].posts).toBe(1);
				expect(await db.sql`select post_id from feed_items where post_id = 456`).toHaveLength(1);
				await db.sql`insert into schema_examples(id,user_id) values (789,123)`;
				const revisions = await history(db.sql);
				expect(revisions.length).toBeGreaterThan(1);
				expect(JSON.parse(revisions.at(-1).statements).length).toBeGreaterThan(0);
				await db.sync(next);
				expect(await history(db.sql)).toHaveLength(revisions.length);
				await db.sql`delete from users where id = 123`;
				expect(await db.sql`select * from schema_examples`).toHaveLength(0);
				expect(await db.sql`select * from posts where id = 456`).toHaveLength(0);
			} finally {
				await db.close();
			}
		},
		30000,
	);
	run(
		`${backend}: ordinary column additions avoid copying populated tables`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.sync_level = { type: "integer", notNull: true, default: { value: 0 }, check: "sync_level between 0 and 9" };
				await db.sync(next);
				expect((await db.sql`select sync_level,bio from users where id = 123`)[0]).toMatchObject({ sync_level: 0, bio: "preserve me" });
				const statements: string[] = JSON.parse((await history(db.sql)).at(-1).statements);
				expect(statements.some((s) => /alter table.*add column/i.test(s))).toBe(true);
				expect(statements.some((s) => s.includes("_xitter_rebuild_"))).toBe(false);
			} finally {
				await db.close();
			}
		},
		30000,
	);

	run(
		`${backend}: default, constraint and index edits are reconciled`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.bio.default = "'new default'";
				next.tables.users.columns.bio.check = "length(bio) <= 100";
				next.indexes.users_email_idx = { table: "users", expressions: ["lower(email)"], unique: true, where: "email is not null" };
				await db.sync(next);
				expect((await db.sql`select bio from users where id = 123`)[0].bio).toBe("preserve me");
				await db.sql`insert into users(id,screen_name,name,password_hash) values (124,'new_schema_user','New user','unused')`;
				expect((await db.sql`select bio from users where id = 124`)[0].bio).toBe("new default");
				await expect(Promise.resolve(db.sql`update users set bio = ${"x".repeat(101)} where id = 123`)).rejects.toThrow();
				const n = (await history(db.sql)).length;
				await db.sync(next);
				expect(await history(db.sql)).toHaveLength(n);
			} finally {
				await db.close();
			}
		},
		30000,
	);
	run(
		`${backend}: custom indexes, views and triggers survive reconciliation`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				await db.sql.unsafe("create table schema_custom_log(user_id bigint references users(id) on delete cascade)");
				await db.sql.unsafe("create index schema_custom_bio on users(bio)");
				await db.sql.unsafe("create view schema_custom_view as select id,bio from users");
				if (backend === "sqlite")
					await db.sql.unsafe("create trigger schema_custom_trigger after update on users begin insert into schema_custom_log(user_id) values (new.id); end");
				else
					await db.sql.unsafe(
						"create function schema_custom_capture() returns trigger language plpgsql as $$ begin insert into schema_custom_log(user_id) values (new.id); return new; end $$; create trigger schema_custom_trigger after update on users for each row execute function schema_custom_capture()",
					);
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.bio.default = { value: "changed" };
				await db.sync(next);
				expect(await db.sql`select * from schema_custom_log`).toHaveLength(0);
				expect((await db.sql`select bio from schema_custom_view where id = 123`)[0].bio).toBe("preserve me");
				await db.sql`update users set bio = 'still works' where id = 123`;
				expect(await db.sql`select * from schema_custom_log`).toHaveLength(1);
				const index =
					backend === "sqlite"
						? await db.sql`select name from sqlite_master where name = 'schema_custom_bio'`
						: await db.sql`select indexname from pg_indexes where indexname = 'schema_custom_bio'`;
				expect(index).toHaveLength(1);
			} finally {
				await db.close();
			}
		},
		30000,
	);

	run(
		`${backend}: invalid upgrades roll back schema, data and history`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const count = (await history(db.sql)).length,
					next: Schema = structuredClone(schema);
				next.tables.users.columns.required_value = { type: "text", notNull: true };
				await expect(db.sync(next)).rejects.toThrow();
				expect(await history(db.sql)).toHaveLength(count);
				expect((await db.sql`select bio from users where id = 123`)[0].bio).toBe("preserve me");
				await expect(Promise.resolve(db.sql`select required_value from users`)).rejects.toThrow();
				await expect(Promise.resolve(db.sql`insert into follows(follower_id,followee_id) values (123,999)`)).rejects.toThrow();
				await db.sync(structuredClone(schema));
			} finally {
				await db.close();
			}
		},
		30000,
	);
	run(
		`${backend}: invalid views roll back the upgrade`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const count = (await history(db.sql)).length,
					next: Schema = structuredClone(schema);
				next.views.schema_invalid_view = "select absent_column from users";
				await expect(db.sync(next)).rejects.toThrow();
				expect(await history(db.sql)).toHaveLength(count);
				expect((await db.sql`select bio from users where id = 123`)[0].bio).toBe("preserve me");
			} finally {
				await db.close();
			}
		},
		30000,
	);

	run(
		`${backend}: ambiguous renames, unsafe casts and downgrades fail without data loss`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const removed: Schema = structuredClone(schema);
				delete removed.tables.users.columns.bio;
				await expect(db.sync(removed)).rejects.toThrow("explicit migration");
				const cast: Schema = structuredClone(schema);
				cast.tables.users.columns.bio.type = "integer";
				await expect(db.sync(cast)).rejects.toThrow("explicit data migration");
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.sync_counter = { type: "integer", default: "0", notNull: true };
				await db.sync(next);
				await expect(db.sync(structuredClone(schema))).rejects.toThrow("downgrade");
				expect((await db.sql`select bio from users where id = 123`)[0].bio).toBe("preserve me");
			} finally {
				await db.close();
			}
		},
		30000,
	);
	run(
		`${backend}: explicit data migrations run once before automatic constraint changes`,
		async () => {
			const db = await fixture(backend);
			try {
				await db.sync(structuredClone(schema));
				await seed(db.sql);
				const next: Schema = structuredClone(schema);
				next.tables.users.columns.required_label = { type: "text", notNull: true };
				const statements = ["alter table users add column required_label text", "update users set required_label = 'backfilled'"];
				const upgrade: Migration = { id: "002-required-label", up: { sqlite: statements, postgres: statements } };
				await db.sync(next, [upgrade]);
				expect((await db.sql`select required_label from users where id = 123`)[0].required_label).toBe("backfilled");
				const revisions = await history(db.sql);
				expect(revisions.filter((r: any) => r.migration_id === upgrade.id)).toHaveLength(1);
				await db.sync(next, [upgrade]);
				expect(await history(db.sql)).toHaveLength(revisions.length);
				const changed = structuredClone(upgrade);
				changed.up[backend].push("select 1");
				await expect(db.sync(next, [changed])).rejects.toThrow("modified");
				await expect(db.sync(next, [])).rejects.toThrow("removed or reordered");
			} finally {
				await db.close();
			}
		},
		30000,
	);
}
