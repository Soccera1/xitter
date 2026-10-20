// Self-contained SQLite regression checks; no running server or Postgres needed.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSQLite } from "../src/sqlite";

const dir = mkdtempSync(join(tmpdir(), "xitter-sqlite-"));
// Set before importing db.ts; never use the developer's configured database.
process.env.DATABASE_URL = `sqlite://${join(dir, "main.sqlite")}`;
process.env.BACKUP_DIR = join(dir, "backups");
const { sql, migrate, databaseBackend, databaseBytes } = await import("../src/db");
const { createBackup, listBackups, deleteBackup, backupPath } = await import("../src/backups");
await migrate();
afterAll(async () => {
	await sql.close();
	rmSync(dir, { recursive: true, force: true });
});

const user = async (id: string, name: string) =>
	sql`insert into users(id, screen_name, name, password_hash) values (${sql.cast(id, "bigint")}, ${name}, ${name}, 'unused')`;

test("SQLite selection, persistent schema, constraints, and complete table/column coverage", async () => {
	expect(databaseBackend).toBe("sqlite");
	const { schema } = await import("../src/schema");
	const tables = await sql`select name from sqlite_master where type = 'table' and name <> '_xitter_schema_history'`;
	expect(tables.map((r: any) => r.name).sort()).toEqual(Object.keys(schema.tables).sort());
	for (const [table, definition] of Object.entries(schema.tables)) {
		const actual = await sql.unsafe(`pragma table_info("${table}")`);
		expect(actual.map((r: any) => r.name).sort()).toEqual(Object.keys(definition.columns).sort());
	}
	const indexes = await sql`select name from sqlite_master where type = 'index'`;
	for (const name of Object.keys(schema.indexes)) expect(indexes.some((r: any) => r.name === name)).toBe(true);
	await user("9007199254740993", "Первый");
	await rejects(user("9007199254740994", "ПЕРВЫЙ"));
	await rejects(Promise.resolve(sql`insert into follows(follower_id,followee_id) values(9007199254740993,999)`));
	await migrate();
	expect((await sql`select ${sql.cast(sql`id`, "text")} as id from users where screen_name = ${"Первый"}`)[0].id).toBe("9007199254740993");
	expect(Number(await databaseBytes())).toBeGreaterThan(0);
});

test("64-bit IDs, JSON, arrays, booleans, blobs, UUID defaults, and aliased timestamps round-trip", async () => {
	const id = "9223372036854775807";
	await user(id, "typed_user");
	await sql`update users set preferences = ${sql.cast(JSON.stringify({ flag: true, nested: { text: "hello" } }), "jsonb")}, protected = ${true} where id = ${sql.cast(id, "bigint")}`;
	const [u] = await sql`select id, ${sql.cast(sql`id`, "text")} as id_str, preferences, protected, created_at as registered from users where id = ${sql.cast(id, "bigint")}`;
	await rejects(Promise.resolve(sql`select ${sql.cast("9223372036854775808", "bigint")} as id`), "out of range");
	expect(u.id).toBe(id);
	expect(u.id_str).toBe(id);
	expect(u.preferences).toEqual({ flag: true, nested: { text: "hello" } });
	expect(u.protected).toBe(true);
	expect(u.registered).toBeInstanceOf(Date);
	await sql`insert into sessions(token,user_id,csrf) values ('test-session',${sql.cast(id, "bigint")},'csrf')`;
	expect((await sql`select id from sessions where token = 'test-session'`)[0].id).toMatch(/^[\da-f-]{36}$/);
	await sql`insert into contacts(id,user_id,vcard,emails) values (201,${sql.cast(id, "bigint")},'card',${sql.array(["a@b.test", "it's@ok.test"], "TEXT")})`;
	expect((await sql`select emails from contacts where id = 201`)[0].emails).toEqual(["a@b.test", "it's@ok.test"]);
	const bytes = Buffer.from([0, 128, 255]);
	await sql`insert into custom_badges(id,name,image,mime) values (201,'test',${bytes},'image/png')`;
	expect(Buffer.from((await sql`select image from custom_badges where id = 201`)[0].image)).toEqual(bytes);
});

test("nested fragments, quoted identifiers, and values cannot inject SQL", async () => {
	const text = "O'Reilly $1 ::bigint -- ilike %; drop table users;";
	const predicate = sql`screen_name = ${"typed_user"}`;
	const nested = sql`${predicate} and id = ${sql.cast("9223372036854775807", "bigint")}`;
	await sql`update users set ${sql({ bio: text })} where ${nested}`;
	expect((await sql`select ${sql("bio")} from users where ${nested}`)[0].bio).toBe(text);
	const literal = await sql`select 'a -- comment ::bigint ilike' as text`;
	expect(literal[0].text).toBe("a -- comment ::bigint ilike");
	expect((await sql`select ${"untouched"} as ${sql("name--::text")}`)[0]["name--::text"]).toBe("untouched");
});

test("Unicode matching, escaped LIKE, array membership, JSON merges, nulls, and intervals", async () => {
	const [match] = await sql`select ${sql.like("Привет", "%прив%", true)} as unicode, ${sql.like("a%b_c", "a\\%b\\_c", true)} as escaped,
		${sql.regex("#привет #hello", "#\\w+", true)} as regex, ${sql.equal(sql`null`, sql`null`)} as same`;
	expect(Number(match.unicode)).toBe(1);
	expect(Number(match.escaped)).toBe(1);
	expect(Number(match.regex)).toBe(1);
	expect(Number(match.same)).toBe(1);
	expect((await sql`select ${sql.cast(sql`id`, "text")} as id from users where ${sql.contains(sql.array(["9223372036854775807"], "INT8"), sql`id`)}`)[0].id).toBe("9223372036854775807");
	expect(await sql`select id from users where ${sql.contains(sql.array([], "INT8"), sql`id`)}`).toHaveLength(0);
	await sql`update users set preferences = ${sql.jsonMerge(sql`preferences`, sql.cast(JSON.stringify({ flag: false, added: null }), "jsonb"))} where screen_name = 'typed_user'`;
	const [row] = await sql`select preferences, ${sql.jsonGet(sql`preferences`, sql`'flag'`, true)} as flag from users where screen_name = 'typed_user'`;
	expect(row.preferences).toEqual({ flag: false, nested: { text: "hello" }, added: null });
	expect(row.flag).toBe("false");
	const [time] = await sql`select ${sql.epoch(sql`( now ( ) - ( now ( ) - ${sql.duration(1, "day")} ) )`)} as seconds`;
	expect(time.seconds).toBeCloseTo(86400, 1);
});

test("async transactions roll back triggers and exclude unrelated work until commit", async () => {
	await user("301", "transaction_user");
	await rejects(sql.begin(async (tx) => {
			await tx`insert into posts(id,user_id,text,conversation_id) values(301,301,'rolled back',301)`;
			await Promise.resolve();
			throw new Error("rollback");
		}), "rollback");
	expect(await sql`select id from posts where id = 301`).toHaveLength(0);
	expect(await sql`select posts from user_stats where user_id = 301`).toHaveLength(0);
	let entered!: () => void, release!: () => void;
	const started = new Promise<void>((resolve) => (entered = resolve)),
		gate = new Promise<void>((resolve) => (release = resolve));
	const tx = sql.begin(async (tx) => {
		await tx`insert into posts(id,user_id,text,conversation_id) values(302,301,'committed',302)`;
		entered();
		await gate;
	});
	await started;
	let observed = false;
	const outside = Promise.resolve(sql`select id from posts where id = 302`).then((rows) => {
		observed = true;
		return rows;
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(observed).toBe(false);
	release();
	await tx;
	expect(await outside).toHaveLength(1);
	await sql`insert into follows(follower_id,followee_id) values(301,9007199254740993)`;
	await sql`insert into likes(user_id,post_id) values(301,302)`;
	expect((await sql`select posts,likes,following from user_stats where user_id = 301`)[0]).toMatchObject({ posts: 1, likes: 1, following: 1 });
	await sql`insert into media(id,user_id,kind,mime,size,width,height,post_id) values(301,301,'photo','image/png',1,1,1,302), (302,301,'photo','image/png',1,1,1,302)`;
	expect((await sql`select media_posts from user_stats where user_id = 301`)[0].media_posts).toBe(1);
	await sql`update media set post_id = null where id = 301`;
	expect((await sql`select media_posts from user_stats where user_id = 301`)[0].media_posts).toBe(1);
	await sql`delete from posts where id = 302`;
	expect((await sql`select media_posts from user_stats where user_id = 301`)[0].media_posts).toBe(0);
	expect((await sql`select posts,likes from user_stats where user_id = 301`)[0]).toMatchObject({ posts: 0, likes: 0 });
	await sql.begin(async (tx) => {
		await tx`update users set name = 'outer' where id = 301`;
		await rejects(tx.begin(async (nested) => {
				await nested`update users set name = 'inner' where id = 301`;
				throw new Error("inner rollback");
			}), "inner rollback");
		expect((await tx`select name from users where id = 301`)[0].name).toBe("outer");
	});
	await sql`delete from users where id = 301`;
	expect(await sql`select * from follows where follower_id = 301`).toHaveLength(0);
});

test("one awaited mutation executes once and consistent WAL snapshots restore and remain writable", async () => {
	const insert = sql`insert into settings ${sql.insert({ key: "once", value: "1" })} returning key`;
	await insert;
	expect(await insert).toHaveLength(1);
	const backup = await createBackup();
	expect(backup.name).toEndWith(".sqlite");
	expect(listBackups()).toHaveLength(1);
	expect(backupPath("../main.sqlite")).toBeUndefined();
	const copy = openSQLite(backupPath(backup.name)!);
	try {
		expect((await copy.sql`select ${copy.sql.cast(copy.sql`id`, "text")} as id from users where screen_name = 'typed_user'`)[0].id).toBe("9223372036854775807");
		expect((await copy.sql`pragma integrity_check`)[0].integrity_check).toBe("ok");
		expect(await copy.sql`pragma foreign_key_check`).toHaveLength(0);
		await copy.sql`insert into users(id,screen_name,name,password_hash) values(501,'restored','Restored','unused')`;
		expect((await copy.sql`select created_at from users where id = 501`)[0].created_at).toBeInstanceOf(Date);
	} finally {
		await copy.sql.close();
	}
	expect(deleteBackup(backup.name)).toBe(true);
	expect(listBackups()).toHaveLength(0);
});

test("application projections retain booleans, JSON and numeric counters", async () => {
	const id = "9223372036854775807";
	await sql`insert into user_badges(user_id,badge_id) values (${sql.cast(id, "bigint")},201)`;
	const { viewerById } = await import("../src/auth");
	const viewer = await viewerById(id);
	expect(viewer!.badges).toEqual([{ id: "201", name: "test" }]);
	expect(viewer!.discoverable_by_email).toBeNull();
	await sql`update users set preferences = ${sql.jsonMerge(sql`preferences`, sql.cast(JSON.stringify({ discoverable_by_email: true }), "jsonb"))} where id = ${sql.cast(id, "bigint")}`;
	expect((await viewerById(id))!.discoverable_by_email).toBe(true);
	await sql`insert into posts(id,user_id,text,conversation_id) values (401,${sql.cast(id, "bigint")},'type contract',401)`;
	const { getPost } = await import("../src/posts");
	const post = await getPost(id, "401");
	expect(post!.liked).toBe(false);
	expect(post!.reposted).toBe(false);
	expect(post!.bookmarked).toBe(false);
	expect(post!.author.stats.following).toBe(0);
	expect(post!.author.id).toBe(id);
	await sql`insert into likes(user_id,post_id) values (${sql.cast(id, "bigint")},401)`;
	expect((await getPost(id, "401"))!.liked).toBe(true);
});

test("in-memory databases work and newer on-disk schema versions are rejected", async () => {
	const memory = openSQLite(":memory:");
	try {
		memory.db.exec(readFileSync(join(import.meta.dir, "../src/db/migrations/sqlite/001-initial.sql"), "utf8"));
		expect(await memory.sql`select id from users`).toHaveLength(0);
	} finally {
		await memory.sql.close();
	}
	const path = join(dir, "newer.sqlite"),
		newer = openSQLite(path);
	newer.db.exec("pragma user_version = 2");
	await newer.sql.close();
	const script = `const {migrate,sql} = await import(${JSON.stringify(new URL("../src/db.ts", import.meta.url).href)}); await migrate(); await sql.close();`;
	const child = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, DATABASE_URL: `sqlite://${path}` } });
	expect(child.exitCode).not.toBe(0);
	expect(child.stderr.toString()).toContain("newer version of Xitter");
});

async function rejects(promise: PromiseLike<any>, message?: string) {
 let error: any; try { await promise; } catch (caught) { error = caught; }
 expect(error).toBeInstanceOf(Error); if(message) expect(error.message).toContain(message);
}
