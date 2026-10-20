import type { Dialect } from "./schema-types";

export interface CompiledQuery {
	text: string;
	values: any[];
	fields?: Record<string, ResultType>;
}
export type ResultType = "boolean" | "date" | "json" | "text" | "number" | "bigint";
export interface Driver {
	// Drivers normalize declared result fields once, before returning rows.
	execute(query: CompiledQuery): Promise<any[]>;
	begin<T>(callback: (driver: Driver) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}
type Node = string | { value: any } | { dialect: Record<Dialect, Fragment> } | { projection: { input: Fragment; name: string; type: ResultType } } | Fragment;
export class ArrayValue {
	constructor(
		readonly values: any[],
		readonly type: string,
	) {
		if (!/^(int8|bigint|text)$/i.test(type)) throw new Error(`Unsupported array type: ${type}`);
	}
}
class Assignments {
	constructor(readonly values: Record<string, any>) {}
}

// Fragments contain structured bindings and dialect operations, never rewritten SQL.
export class Fragment implements PromiseLike<any[]> {
	private pending?: Promise<any[]>;
	constructor(
		readonly nodes: Node[],
		private readonly run: (fragment: Fragment) => Promise<any[]>,
		readonly resultType?: ResultType,
	) {}
	then<TResult1 = any[], TResult2 = never>(
		a?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
		b?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2> {
		return (this.pending ??= this.run(this)).then(a, b);
	}
	catch(b: any) {
		return this.then(undefined, b);
	}
}
export function compile(fragment: Fragment, dialect: Dialect): CompiledQuery {
	const values: any[] = [];
	const fields: Record<string, ResultType> = Object.create(null);
	function render(nodes: Node[]): string {
		return nodes
			.map((node) => {
				if (typeof node === "string") return node;
				if (node instanceof Fragment) return render(node.nodes);
				if ("dialect" in node) return render(node.dialect[dialect].nodes);
				if ("projection" in node) {
					const { input, name, type } = node.projection;
					const source = render(input.nodes);
					fields[name] = type;
					return `${source} as ${quote(name)}`;
				}
				values.push(node.value);
				if (dialect === "postgres" && node.value instanceof ArrayValue) {
					const type = /^(int8|bigint)$/i.test(node.value.type) ? "bigint[]" : /^text$/i.test(node.value.type) ? "text[]" : undefined;
					if (!type) throw new Error(`Unsupported array type: ${node.value.type}`);
					return `cast($${values.length} as ${type})`;
				}
				return `$${values.length}`;
			})
			.join("");
	}
	return { text: render(fragment.nodes), values, fields };
}
export function decodeFields(rows: any[], fields: CompiledQuery["fields"], jsonEncoded = true) {
	for (const row of rows)
		for (const [name, type] of Object.entries(fields ?? {})) {
			const value = row[name];
			if (value == null) continue;
			row[name] =
				type === "boolean"
					? !!value
					: type === "date"
						? new Date(typeof value === "bigint" ? Number(value) : value)
						: type === "json" && jsonEncoded && typeof value === "string"
							? JSON.parse(value)
							: type === "text" || type === "bigint"
								? String(value)
								: type === "number"
									? Number(value)
									: value;
		}
	return rows;
}
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export type CastType =
	| "text"
	| "bigint"
	| "int"
	| "integer"
	| "double precision"
	| "boolean"
	| "timestamptz"
	| "date"
	| "interval"
	| "json"
	| "jsonb"
	| "uuid"
	| "bigint[]"
	| "text[]";

export function createSQL(driver: Driver, dialect: Dialect) {
	const fragment = (nodes: Node[], resultType?: ResultType) => new Fragment(nodes, (value) => driver.execute(compile(value, dialect)), resultType);
	const value = (input: any): Node => (input instanceof Fragment ? input : { value: input });
	function sql(first: string): Fragment;
	function sql(first: TemplateStringsArray, ...values: any[]): Fragment;
	function sql(first: Record<string, any>): Assignments;
	function sql(first: any, ...values: any[]): any {
		if (!Array.isArray(first) || !("raw" in first)) {
			if (typeof first === "string") return fragment([quote(first)]);
			return new Assignments(first);
		}
		const nodes: Node[] = [first[0]];
		for (let i = 0; i < values.length; i++) {
			const item = values[i];
			if (item instanceof Assignments) {
				const entries = Object.entries(item.values);
				// Object interpolation is only for an UPDATE's SET list. INSERT uses
				// sql.insert(), avoiding context-sensitive interpretation of SQL text.
				entries.forEach(([name, input], index) => {
					if (index) nodes.push(", ");
					nodes.push(`${quote(name)} = `, value(input));
				});
			} else nodes.push(value(item));
			nodes.push(first[i + 1]);
		}
		return fragment(nodes);
	}
	const choose = (postgres: Fragment, sqlite: Fragment, resultType?: ResultType) => fragment([{ dialect: { postgres, sqlite } }], resultType);
	const raw = (text: string) => fragment([text]);
	const expr = (input: any) => fragment([value(input)]);
	const join = (items: any[], separator = ", ") => fragment(items.flatMap((item, i) => (i ? [separator, value(item)] : [value(item)])));
	// Physical columns use backend metadata; computed fields declare their JS type
	// here so adding a new projection needs no SQLite-specific decoder changes.
	sql.project = (input: any, name: string, type: ResultType) => fragment([{ projection: { input: expr(input), name, type } }]);
	sql.array = (values: any[], type = "TEXT") => new ArrayValue(values, type);
	sql.insert = (record: Record<string, any>) => {
		const entries = Object.entries(record);
		return sql`(${join(entries.map(([name]) => sql(name)))}) values (${join(entries.map(([, item]) => expr(item)))})`;
	};
	// Escape hatch for trusted, already-native SQL (migrations and diagnostics).
	// Ordinary application queries use templates and the operations below.
	sql.unsafe = (text: string, values: any[] = []) => {
		if (values.length) throw new Error("Use tagged SQL bindings instead of unsafe parameters");
		return raw(text);
	};
	sql.begin = <T>(callback: (tx: ReturnType<typeof createSQL>) => Promise<T>): Promise<T> =>
		driver.begin((transaction) => callback(createSQL(transaction, dialect)));
	sql.close = () => driver.close();
	sql.end = sql.close;
	sql.cast = (input: any, type: CastType): Fragment => {
		if (
			![
				"text",
				"bigint",
				"int",
				"integer",
				"double precision",
				"boolean",
				"timestamptz",
				"date",
				"interval",
				"json",
				"jsonb",
				"uuid",
				"bigint[]",
				"text[]",
			].includes(type)
		)
			throw new Error(`Unsupported cast type: ${type}`);
		const source = expr(input);
		const postgres = type === "json" || type === "jsonb" ? sql`cast(cast(${source} as text) as ${raw(type)})` : sql`cast(${source} as ${raw(type)})`;
		const sqlite = type.endsWith("[]")
			? source
			: type === "json" || type === "jsonb"
				? sql`json(${source})`
				: type === "bigint"
					? sql`pg_bigint(${source})`
					: type === "timestamptz" || type === "date"
						? sql`epoch_ms(${source})`
						: type === "interval"
							? sql`interval_ms(${source})`
							: type === "boolean"
								? sql`boolean_value(${source})`
								: sql`cast(${source} as ${raw(type === "uuid" ? "text" : type === "double precision" ? "real" : type)})`;
		const resultType =
			type === "boolean"
				? "boolean"
				: type === "json" || type === "jsonb" || type.endsWith("[]")
					? "json"
					: type === "timestamptz" || type === "date"
						? "date"
						: type === "text" || type === "uuid"
							? "text"
							: type === "bigint"
								? "bigint"
								: "number";
		return choose(postgres, sqlite, resultType);
	};
	sql.duration = (amount: any, unit: "second" | "minute" | "hour" | "day" | "week") => {
		const ms = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[unit];
		if (!ms) throw new Error(`Unsupported duration unit: ${unit}`);
		return choose(sql`(${amount} * ${raw(`interval '1 ${unit}'`)})`, sql`(${amount} * ${ms})`);
	};
	sql.epoch = (input: any) => choose(sql`extract(epoch from ${input})`, sql`(1.0 * ${input} / 1000)`);
	sql.contains = (array: any, item: any) => {
		const element = array instanceof ArrayValue && /^(int8|bigint)$/i.test(array.type) ? sql`pg_bigint(value)` : sql`cast(value as text)`;
		return choose(sql`(${item} = any(${array}))`, sql`(${item} in (select ${element} from json_each(${array})))`, "boolean");
	};
	sql.equal = (a: any, b: any) => choose(sql`(${a} is not distinct from ${b})`, sql`(${a} is ${b})`, "boolean");
	sql.like = (a: any, pattern: any, insensitive = false) =>
		choose(
			insensitive ? sql`(${a} collate "pg_c_utf8" ilike ${pattern})` : sql`(${a} like ${pattern})`,
			sql`pg_like(${a}, ${pattern}, ${insensitive})`,
			"boolean",
		);
	sql.regex = (a: any, pattern: any, insensitive = false) =>
		choose(
			insensitive ? sql`(${a} collate "pg_c_utf8" ~* ${pattern})` : sql`(${a} collate "pg_c_utf8" ~ ${pattern})`,
			sql`regexp_pg(${pattern}, ${a}, ${insensitive})`,
			"boolean",
		);
	sql.jsonGet = (a: any, key: any, text = false) => {
		if (typeof key === "number" && !Number.isInteger(key)) throw new Error("JSON array index must be an integer");
		const postgresKey = typeof key === "number" ? sql.cast(key, "int") : key;
		return choose(
			text ? sql`(${a} ->> ${postgresKey})` : sql`(${a} -> ${postgresKey})`,
			text ? sql`json_text(${a}, ${key})` : sql`json_get(${a}, ${key})`,
			text ? "text" : "json",
		);
	};
	sql.jsonMerge = (a: any, b: any) => choose(sql`(${a} || ${b})`, sql`json_concat(${a}, ${b})`, "json");
	sql.jsonDelete = (a: any, key: any) => {
		if (typeof key === "number" && !Number.isInteger(key)) throw new Error("JSON array index must be an integer");
		return choose(sql`(${a} - ${typeof key === "number" ? sql.cast(key, "int") : key})`, sql`json_delete(${a}, ${key})`, "json");
	};
	sql.jsonSet = (a: any, path: string[] | string | Fragment, replacement: any) => {
		const keys = Array.isArray(path) ? sql.array(path, "TEXT") : path;
		return fragment([sql`jsonb_set(${a}, ${keys}, ${replacement})`], "json");
	};
	sql.jsonObject = (...pairs: any[]) => {
		if (pairs.length % 2) throw new Error("JSON objects require key/value pairs");
		// PostgreSQL's variadic "any" arguments need explicit types for bindings.
		const typed = pairs.map((item, i) =>
			item instanceof Fragment
				? item
				: i % 2 && item !== null && typeof item === "object"
					? sql.cast(JSON.stringify(item), "jsonb")
					: sql.cast(
							item,
							i % 2 === 0 || typeof item === "string" || item == null
								? "text"
								: typeof item === "boolean"
									? "boolean"
									: typeof item === "bigint" || Number.isInteger(item)
										? "bigint"
										: "double precision",
						),
		);
		const sqlite = pairs.map((item, i) => {
			if (!(i % 2)) return item;
			if (typeof item === "boolean") return sql`json(${JSON.stringify(item)})`;
			if (item instanceof Fragment) {
				if (item.resultType === "json") return sql`json(${item})`;
				if (item.resultType === "boolean") return sql`json(case when ${item} is null then null when ${item} then 'true' else 'false' end)`;
				return item;
			}
			return item !== null && typeof item === "object" ? sql.cast(JSON.stringify(item), "jsonb") : item;
		});
		return choose(sql`jsonb_build_object(${join(typed)})`, sql`json_object(${join(sqlite)})`, "json");
	};
	sql.jsonAgg = (input: any, order?: Fragment, json = true, filter?: Fragment) => {
		const predicate = filter ? sql` filter (where ${filter})` : raw("");
		return choose(
			sql`coalesce(jsonb_agg(${json ? sql`cast(${input} as jsonb)` : expr(input)}${order ? sql` order by ${order}` : raw("")})${predicate}, '[]')`,
			sql`json_group_array(${json ? sql`json(${input})` : expr(input)}${order ? sql` order by ${order}` : raw("")})${predicate}`,
			"json",
		);
	};
	sql.arrayAgg = (input: any, order?: Fragment) =>
		choose(
			sql`coalesce(array_agg(${input}${order ? sql` order by ${order}` : raw("")}), '{}')`,
			sql`json_group_array(${input}${order ? sql` order by ${order}` : raw("")})`,
			"json",
		);
	sql.boolOr = (input: any) => choose(sql`bool_or(${input})`, sql`max(${input})`, "boolean");
	const extremum = (args: any[], name: "max" | "min") => {
		if (!args.length) throw new Error("An extremum requires at least one argument");
		return sql`(select ${raw(name)}(value) from (${join(
			args.map((arg) => sql`select ${arg} as value`),
			" union all ",
		)}))`;
	};
	sql.greatest = (...args: any[]) => choose(sql`greatest(${join(args)})`, extremum(args, "max"));
	sql.least = (...args: any[]) => choose(sql`least(${join(args)})`, extremum(args, "min"));
	sql.position = (needle: any, haystack: any) => choose(sql`position(${needle} in ${haystack})`, sql`instr(${haystack}, ${needle})`);
	sql.lock = (skipLocked = false) => choose(raw(skipLocked ? "for update skip locked" : "for update"), raw(""));
	sql.each = (array: any) =>
		choose(sql`lateral (select value, n - 1 as key from unnest(${array}) with ordinality as elements(value, n))`, sql`json_each(${array})`);
	sql.regexMatches = (input: any, pattern: any) =>
		choose(
			sql`lateral (select captures[1] as value from regexp_matches(${input} collate "pg_c_utf8", ${pattern}, 'g') captures)`,
			sql`json_each(regexp_matches_json(${input}, ${pattern}))`,
		);
	sql.singleton = (input: any) => choose(sql`array[${input}]`, sql`json_array(${sql.cast(input, "text")})`);
	sql.append = (array: any, input: any) => choose(sql`(${array} || ${input})`, sql`json_insert(${array}, '$[#]', ${sql.cast(input, "text")})`);
	sql.days = (count: number) => {
		if (!Number.isInteger(count) || count < 1 || count > 3660) throw new Error("Day series requires 1–3660 days");
		return choose(
			sql`(select d from generate_series(date_trunc('day', now()) - ${sql.duration(count - 1, "day")}, date_trunc('day', now()), ${sql.duration(1, "day")}) d)`,
			sql`(with recursive days(d) as (select date_trunc('day', now()) - ${(count - 1) * 86400000} union all select d + 86400000 from days where d < date_trunc('day', now())) select d from days)`,
		);
	};
	return sql;
}
export type QuerySQL = ReturnType<typeof createSQL>;
