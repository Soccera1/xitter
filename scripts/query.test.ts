import { expect, test } from "bun:test";
import { SQL } from "bun";
import { compile, createSQL, type Driver, type QuerySQL } from "../src/db/query";
import { postgresQueries } from "../src/db/postgres";
import { sqliteClient } from "../src/db/sqlite-client";
import { checkQueries } from "./check-queries";

async function rejected(promise: PromiseLike<unknown>) {
	try {
		await promise;
	} catch (error) {
		return error as Error;
	}
	throw new Error("Expected an operation to fail");
}
async function connection(backend: "sqlite" | "postgres"): Promise<QuerySQL> {
	return backend === "sqlite" ? sqliteClient(":memory:").sql : postgresQueries(new SQL(process.env.TEST_POSTGRES_URL!, { max: 1 }));
}
for (const backend of ["sqlite", "postgres"] as const) {
	const run = backend === "postgres" && !process.env.TEST_POSTGRES_URL ? test.skip : test;
	run(`${backend}: scalar and nested JSON values are decoded exactly once`, async () => {
		const sql = await connection(backend);
		try {
			for (const encoded of ['"hello"', '"true"', '"{not an object}"', "false", "42", "null"]) {
				const [row] = await sql`select ${sql.project(sql.cast(encoded, "jsonb"), "scalar", "json")}`;
				expect(row.scalar).toEqual(JSON.parse(encoded));
			}
			const [nested] = await sql`select ${sql.project(sql`(select ${sql.project(sql`1`, "value", "number")})`, "value", "text")}`;
			expect(nested.value).toBe("1");
			const [row] = await sql`select ${sql.project(
				sql.jsonObject(
					"flag",
					sql.cast("yes", "boolean"),
					"missing",
					sql.cast(null, "boolean"),
					"nested",
					{ flag: false },
					"items",
					[1, "two"],
					"merged",
					sql.jsonMerge(sql.cast('{"old":true}', "jsonb"), sql.cast('{"new":true}', "jsonb")),
				),
				"document",
				"json",
			)}`;
			expect(row.document).toEqual({ flag: true, missing: null, nested: { flag: false }, items: [1, "two"], merged: { old: true, new: true } });
		} finally {
			await sql.close();
		}
	});
	run(`${backend}: JSON array paths and missing object keys agree`, async () => {
		const sql = await connection(backend);
		try {
			const array = sql.cast('["first","last","first"]', "jsonb");
			const [row] = await sql`select ${sql.project(sql.jsonGet(array, -1), "last", "json")},
				${sql.project(sql.jsonGet(array, -2, true), "text", "text")},
				${sql.project(sql.jsonDelete(array, -1), "trimmed", "json")},
				${sql.project(sql.jsonDelete(array, "first"), "removed", "json")},
				${sql.project(sql.jsonGet(sql.cast("{}", "jsonb"), "constructor", true), "missing", "text")},
				${sql.project(sql.jsonSet(sql.cast('{"nested":[1,2]}', "jsonb"), ["nested", "-1"], sql.cast("3", "jsonb")), "changed", "json")},
				${sql.project(sql.jsonSet(sql.cast("{}", "jsonb"), ["__proto__", "polluted"], sql.cast("true", "jsonb")), "safe", "json")}`;
			expect(row).toEqual({ last: "first", text: "last", trimmed: ["first", "last"], removed: ["last"], missing: null, changed: { nested: [1, 3] }, safe: {} });
		} finally {
			await sql.close();
		}
	});
	run(`${backend}: boolean casts and invalid patterns fail consistently`, async () => {
		const sql = await connection(backend);
		try {
			for (const value of ["yes", "t", "ON", " true ", "1"]) {
				const [row] = await sql`select ${sql.project(sql.cast(value, "boolean"), "value", "boolean")}`;
				expect(row.value).toBe(true);
			}
			for (const value of ["no", "f", "OFF", " false ", "0"]) {
				const [row] = await sql`select ${sql.project(sql.cast(value, "boolean"), "value", "boolean")}`;
				expect(row.value).toBe(false);
			}
			expect(await rejected(sql`select ${sql.cast("invalid", "boolean")}`)).toBeInstanceOf(Error);
			expect(await rejected(sql`select ${sql.like("trailingx", "trailing\\")}`)).toBeInstanceOf(Error);
		} finally {
			await sql.close();
		}
	});
	run(`${backend}: semantic operations preserve values and explicit result types`, async () => {
		const sql = await connection(backend);
		try {
			const id = "9223372036854775807";
			const [row] = await sql`select
				${sql.project(sql.cast(id, "bigint"), "large", "bigint")},
				${sql.project(sql.like("Привет_%", "%прив%", true), "match", "boolean")},
				${sql.project(sql.like("a%b_c", "a\\%b\\_c"), "escaped", "boolean")},
				${sql.project(sql.regex("#привет #hello", "#\\w+", true), "regex", "boolean")},
				${sql.project(sql.contains(sql.array([id], "INT8"), sql.cast(id, "bigint")), "member", "boolean")},
				${sql.project(sql.contains(sql.array([], "INT8"), sql.cast(id, "bigint")), "empty", "boolean")},
				${sql.project(sql.equal(null, null), "nulls", "boolean")},
				${sql.project(sql.jsonObject("text", "a'b $1 ::bigint", "n", 1.5, "flag", true, "nil", null), "document", "json")},
				${sql.project(sql.cast(new Date("2025-01-02T03:04:05Z"), "timestamptz"), "instant", "date")},
				${sql.project(sql.greatest(sql.cast(null, "int"), sql.cast(2, "int"), sql.cast(1, "int")), "largest", "number")},
				${sql.project(sql.least(sql.cast(null, "int"), sql.cast(2, "int"), sql.cast(1, "int")), "smallest", "number")}`;
			expect(row).toEqual({
				large: id,
				match: true,
				escaped: true,
				regex: true,
				member: true,
				empty: false,
				nulls: true,
				document: { text: "a'b $1 ::bigint", n: 1.5, flag: true, nil: null },
				instant: new Date("2025-01-02T03:04:05Z"),
				largest: 2,
				smallest: 1,
			});
			expect((await rejected(sql`select ${sql.cast("9223372036854775808", "bigint")}`)).message).toContain("out of range");
		} finally {
			await sql.close();
		}
	});
	run(`${backend}: arrays, JSON changes, time arithmetic and table expressions agree`, async () => {
		const sql = await connection(backend);
		try {
			const document = sql.cast(JSON.stringify({ a: 1, flag: true, nested: { old: true } }), "jsonb");
			const changed = sql.jsonSet(sql.jsonDelete(document, "flag"), "{nested}", sql.cast('{"new":true}', "jsonb"));
			const [row] = await sql`select ${sql.project(changed, "changed", "json")},
				${sql.project(sql.jsonMerge(sql.cast("[1,2]", "jsonb"), sql.cast("[3]", "jsonb")), "merged", "json")},
				${sql.project(sql.epoch(sql`(now() - (now() - ${sql.duration(1, "day")}))`), "seconds", "number")}`;
			expect(row.changed).toEqual({ a: 1, nested: { new: true } });
			expect(row.merged).toEqual([1, 2, 3]);
			expect(row.seconds).toBeCloseTo(86400, 1);
			const list = await sql`select ${sql.project(sql.cast(sql`e.key`, "int"), "position", "number")},
				${sql.project(sql`e.value`, "value", "text")} from ${sql.each(sql.array(["first", "second"], "TEXT"))} e order by e.key`;
			expect(list).toEqual([
				{ position: 0, value: "first" },
				{ position: 1, value: "second" },
			]);
			const tags = await sql`select m.value from (select ${sql.cast("#one #two", "text")} as text) p
				cross join ${sql.regexMatches(sql`p.text`, "#(\\w+)")} m order by m.value`;
			expect(tags.map((row) => row.value)).toEqual(["one", "two"]);
			const days = await sql`select count(*) as n from ${sql.days(14)} d`;
			expect(Number(days[0].n)).toBe(14);
			const [empty] = await sql`select ${sql.project(sql.jsonAgg(sql`'{}'`), "documents", "json")},
				${sql.project(sql.arrayAgg(sql`1`), "numbers", "json")} from (select 1 as n) t where false`;
			expect(empty).toEqual({ documents: [], numbers: [] });
			await sql`create temporary table query_documents (position integer, document jsonb)`;
			await sql`insert into query_documents values (1, ${sql.cast('{"flag":true}', "jsonb")}), (2, ${sql.cast('{"flag":false}', "jsonb")})`;
			const [filtered] =
				await sql`select ${sql.project(sql.jsonAgg(sql`document`, undefined, true, sql`position = 1`), "documents", "json")} from query_documents`;
			expect(filtered.documents).toEqual([{ flag: true }]);
		} finally {
			await sql.close();
		}
	});
	run(`${backend}: nested rollback and bound fragments preserve transaction boundaries`, async () => {
		const sql = await connection(backend);
		try {
			await sql`create temporary table query_contract(id integer primary key, value text)`;
			await sql.begin(async (tx) => {
				await tx`insert into query_contract ${tx.insert({ id: 1, value: "outer" })}`;
				await rejected(
					tx.begin(async (nested) => {
						await nested`update query_contract set value = 'inner' where id = 1`;
						throw new Error("rollback inner");
					}),
				);
				expect((await tx`select value from query_contract where id = 1`)[0].value).toBe("outer");
			});
			const value = "x' $1; drop table query_contract; --";
			const predicate = sql`id = ${1}`;
			const update = sql`update query_contract set ${sql({ value })} where ${predicate} returning value`;
			expect((await update)[0].value).toBe(value);
			expect(await update).toHaveLength(1);
			expect((await sql`select ${sql("value")} from query_contract`)[0].value).toBe(value);
		} finally {
			await sql.close();
		}
	});
}

test("SQLite worker leaves the event loop responsive during a long query", async () => {
	const sql = sqliteClient(":memory:").sql;
	try {
		await sql`select 1`;
		let finished = false;
		const query = Promise.resolve(sql`with recursive n(x) as (select 1 union all select x + 1 from n where x < 3000000) select sum(x) as total from n`).then(
			(rows) => {
				finished = true;
				return rows;
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(finished).toBe(false);
		expect(Number((await query)[0].total)).toBe(4500001500000);
	} finally {
		await sql.close();
	}
}, 15000);

test("SQLite startup errors and closed connections reject pending work", async () => {
	const broken = sqliteClient("/dev/null/xitter.sqlite");
	expect((await rejected(broken.sql`select 1`)).message).toBeTruthy();
	await rejected(broken.sql.close());
	const working = sqliteClient(":memory:");
	await working.sql`select 1`;
	await working.sql.close();
	expect((await rejected(working.sql`select 1`)).message).toContain("closed");
});

test("portable templates bind nested values without rewriting SQL-looking strings", () => {
	const driver = {} as Driver;
	const sql = createSQL(driver, "sqlite");
	const value = "::bigint ilike $1 ' --";
	const predicate = sql`id = ${"123"}`;
	const query = compile(sql`select '::text ilike' as ${sql("name--::text")} where ${predicate} and text = ${value}`, "sqlite");
	expect(query.text).toBe("select '::text ilike' as \"name--::text\" where id = $1 and text = $2");
	expect(query.values).toEqual(["123", value]);
});

test("portability guard catches backend-specific SQL and native escape hatches", () => {
	expect(checkQueries("example.ts", "sql`select id::text from users where name ilike ${name}`").length).toBeGreaterThan(0);
	expect(checkQueries("example.ts", "sql`select unsupported_function(id) from users`").length).toBeGreaterThan(0);
	expect(checkQueries("example.ts", "sql`select distinct on (id) id from users`").length).toBeGreaterThan(0);
	expect(checkQueries("example.ts", 'sql.unsafe("select 1")').length).toBeGreaterThan(0);
	expect(checkQueries("example.ts", 'sql`select ${sql.cast(sql`id`, "text")} from users where ${sql.like(sql`name`, name, true)}`')).toEqual([]);
	expect(checkQueries("example.ts", "sql`select '::bigint ilike any()' as \"name::text\"`")).toEqual([]);
});
