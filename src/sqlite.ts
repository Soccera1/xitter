// SQLite implementation of the small tagged SQL interface used by the app.
// Values are always bound; only trusted SQL fragments and quoted identifiers
// participate in compilation. PostgreSQL remains the canonical query dialect.
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function pgRegex(pattern: string, flags = "") {
	pattern = pattern.replaceAll("[:alnum:]", "\\p{L}\\p{N}");
	let inside = false,
		result = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === "\\") {
			const next = pattern[++i];
			result += next === "w" ? (inside ? "\\p{L}\\p{N}_" : "[\\p{L}\\p{N}_]") : "\\" + next;
		} else {
			if (c === "[") inside = true;
			if (c === "]") inside = false;
			result += c;
		}
	}
	return new RegExp(result, flags + "u");
}

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const units: Record<string, number> = { second: 1000, minute: 60000, min: 60000, hour: 3600000, day: 86400000, week: 604800000 };
function interval(value: string) {
	const m = /^\s*([\d.]+)\s+(\w+)\s*$/.exec(value);
	if (!m || !units[m[2].replace(/s$/, "")]) throw new Error(`Unsupported interval: ${value}`);
	return Number(m[1]) * units[m[2].replace(/s$/, "")];
}

// Translate the PostgreSQL constructs used by this repository. Complex queries
// use explicit backend branches; this is not a general PostgreSQL SQL parser.
// Tokenize first so SQL-looking text in literals/identifiers is never changed.
export function sqliteSQL(source: string): string {
	const literals: string[] = [];
	const identifiers: string[] = [];
	let s = source.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (value) => {
		if (value.startsWith("'")) return `__lit${literals.push(value) - 1}__`;
		if (value.startsWith('"')) return `__ident${identifiers.push(value) - 1}__`;
		return " ";
	});
	const literal = (token: string) => literals[Number(/\d+/.exec(token)![0])].slice(1, -1).replaceAll("''", "'");
	s = s.replace(/\binterval\s+(__lit\d+__)/gi, (_, v) => String(interval(literal(v))));
	s = s.replace(/\bmake_interval\(\s*(days|hours|mins)\s*=>\s*([^()]+)\)/gi, (_, unit, n) => `(${n} * ${units[unit.replace(/s$/, "")]})`);
	// Keep the PostgreSQL result name for selected casts without an explicit alias.
	const tokens = s
		.match(/__lit\d+__|\$\d+|"(?:""|[^"])*"|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\w+|::|->>|->|<>|!=|<=|>=|\|\||~\*|!~\*|!~|[\s\S]/g)!
		.filter((t) => !/^\s+$/.test(t));
	function start(i: number): number {
		if (tokens[i] === ")" || tokens[i] === "]") {
			const close = tokens[i],
				open = close === ")" ? "(" : "[";
			let depth = 1;
			while (--i >= 0) {
				if (tokens[i] === close) depth++;
				if (tokens[i] === open) {
					depth--;
					if (depth === 0) break;
				}
			}
			// function call, except SQL keywords before a grouped expression
			if (i > 0 && /^\w+$/.test(tokens[i - 1]) && !/^(select|where|and|or|not|in|exists|when|then|else|from|on|as|by|having|returning)$/i.test(tokens[i - 1]))
				i--;
		}
		if (tokens[i]?.toLowerCase() === "filter") return start(i - 1);
		while (i >= 2 && tokens[i - 1] === ".") i -= 2;
		return i;
	}
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] !== "::") continue;
		const from = start(i - 1),
			type = tokens[i + 1].toLowerCase();
		let end = i + 2;
		const array = tokens[end] === "[" && tokens[end + 1] === "]";
		if (array) end += 2;
		const expr = tokens.slice(from, i).join(" ");
		let value = expr;
		if (!array) {
			if (type === "text" || type === "uuid") value = `cast(${expr} as text)`;
			else if (type === "bigint") value = `pg_bigint(${expr})`;
			else if (type === "int" || type === "integer") value = `cast(${expr} as integer)`;
			else if (type === "timestamptz" || type === "date") value = `epoch_ms(${expr})`;
			else if (type === "interval") value = `interval_ms(${expr})`;
			else if (type === "boolean") value = `boolean_value(${expr})`;
		}
		// Bare selected column casts retain their column name in PostgreSQL.
		if (/^(?:[a-z_]\w* \. )?[a-z_]\w*$/i.test(expr) && /^(,|from|$)$/i.test(tokens[end] ?? "")) {
			let depth = 0,
				selected = false;
			for (let j = from - 1; j >= 0; j--) {
				if (tokens[j] === ")") depth++;
				if (tokens[j] === "(") {
					if (!depth) break;
					depth--;
				}
				if (!depth && /^(select|returning|where|values|on|order|group|having)$/i.test(tokens[j])) {
					selected = /^(select|returning)$/i.test(tokens[j]);
					break;
				}
			}
			if (selected) value += ` as ${expr.split(" ").at(-1)}`;
		}
		tokens.splice(from, end - from, value);
		i = from;
	}
	for (let i = 0; i < tokens.length; i++) {
		if (
			!/^(~|~\*|!~|!~\*|ilike|like|->>)$/i.test(tokens[i]) &&
			!(/^(\|\||-)$/.test(tokens[i]) && /^(preferences|email_settings|education_flags|settings)$/i.test(tokens[i - 1]))
		)
			continue;
		const from = start(i - 1);
		let end = i + 2;
		if (tokens[i + 1] === "(" || tokens[i + 2] === "(") {
			let depth = 0;
			end = tokens[i + 1] === "(" ? i + 1 : i + 2;
			do {
				if (tokens[end] === "(") depth++;
				if (tokens[end] === ")") depth--;
				end++;
			} while (depth && end < tokens.length);
		} else while (tokens[end] === ".") end += 2;
		const lhs = tokens.slice(from, i).join(" "),
			rhs = tokens.slice(i + 1, end).join(" ");
		const op = tokens[i].toLowerCase();
		const value =
			op === "-"
				? `json_delete(${lhs}, ${rhs})`
				: op === "||"
					? `json_concat(${lhs}, ${rhs})`
					: op === "->>"
						? `json_text(${lhs}, ${rhs})`
						: /like$/.test(op)
							? `pg_like(${lhs}, ${rhs}, ${op === "ilike" ? 1 : 0})`
							: `${op.startsWith("!") ? "not " : ""}regexp_pg(${rhs}, ${lhs}, ${op.endsWith("*") ? 1 : 0})`;
		tokens.splice(from, end - from, value);
		i = from;
	}

	s = tokens.join(" ");
	s = s.replace(/\bas\s+returning\b/gi, 'as "returning"');
	s = s.replace(/\bupdate\s+(\w+)\s+(\w+)\s+set\b/gi, "update $1 as $2 set");
	// ANY/ALL take either a JSON array column or one bound JSON array.
	s = s.replace(/=\s*any\s*\(/gi, "in (select value from json_each(").replace(/<>\s*all\s*\(/gi, "not in (select value from json_each(");
	// Close the subquery introduced above, respecting nested expressions.
	const marker = /(?:not )?in \(select value from json_each\(/g;
	let m: RegExpExecArray | null;
	while ((m = marker.exec(s))) {
		let depth = 1,
			i = marker.lastIndex;
		for (; i < s.length; i++) {
			if (s[i] === "(") depth++;
			if (s[i] === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		s = s.slice(0, i + 1) + ")" + s.slice(i + 1);
		marker.lastIndex = i + 2;
	}
	s = s.replace(/\bis\s+not\s+distinct\s+from\b/gi, "is").replace(/\bis\s+distinct\s+from\b/gi, "is not");
	s = s.replace(/\bfor\s+update(?:\s+skip\s+locked)?/gi, "");
	s = s.replace(/\bextract\s*\(\s*epoch\s+from\s+/gi, "(1.0 / 1000 * ");
	s = s.replace(/\bposition\s*\(\s*(lower\s*\([^()]*\))\s+in\s+(lower\s*\([^()]*\))\s*\)/gi, "instr($2, $1)");
	s = s.replace(/\bjsonb_agg\s*\(\s*([\w. ]+)\s*\)/gi, "json_group_array(json($1))");
	s = s
		.replace(/\bjsonb?_agg\b/gi, "json_group_array")
		.replace(/\barray_agg\b/gi, "json_group_array")
		.replace(/\bjsonb?_build_object\b/gi, "json_object");
	s = s
		.replace(/\bbool_or\b/gi, "max")
		.replace(/\bgreatest\b/gi, "max")
		.replace(/\bleast\b/gi, "min")
		.replace(/\bchar_length\b/gi, "length");
	s = s.replace(/__(lit|ident)(\d+)__/g, (_, kind, i) => (kind === "lit" ? literals : identifiers)[Number(i)]);
	return s;
}

class Fragment implements PromiseLike<any[]> {
	constructor(
		readonly source: string,
		readonly values: any[],
		private execute: (fragment: Fragment) => Promise<any[]>,
	) {}
	private pending?: Promise<any[]>;
	private run() {
		return (this.pending ??= this.execute(this));
	}
	then(a?: any, b?: any): any {
		return this.run().then(a, b);
	}
	catch(b: any) {
		return this.run().catch(b);
	}
}

export function openSQLite(filename: string) {
	if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
	const connection = new DatabaseSync(filename);
	const db = {
		exec: (source: string) => connection.exec(source),
		query: (source: string) => {
			const statement = connection.prepare(source);
			statement.setReadBigInts(true);
			statement.setAllowUnknownNamedParameters(true);
			return statement;
		},
		function: (name: string, fn: (...args: any[]) => any) => connection.function(name, { useBigIntArguments: true }, fn),
		close: () => connection.close(),
	};
	db.exec("pragma foreign_keys = on; pragma journal_mode = WAL; pragma busy_timeout = 10000;");
	db.function("now", () => Date.now());
	db.function("gen_random_uuid", () => crypto.randomUUID());
	db.function("pg_bigint", (value: any) => {
		if (value == null) return null;
		if (!/^[+-]?\d+$/.test(String(value).trim())) throw new Error("Invalid bigint");
		const n = BigInt(value);
		if (n < -9223372036854775808n || n > 9223372036854775807n) throw new Error("bigint out of range");
		return n;
	});
	db.function("epoch_ms", (v: any) => (v == null ? null : typeof v === "string" && !/^\d+$/.test(v) ? Date.parse(v) : Number(v)));
	db.function("interval_ms", (v: any) => (v == null ? null : interval(String(v))));
	db.function("date_trunc", (unit: any, v: any) => {
		const n = Number(v);
		return Math.floor(n / units[String(unit)]) * units[String(unit)];
	});
	db.function("to_char", (v: any, format: any) => {
		if (format !== "YYYY-MM-DD") throw new Error("Unsupported date format");
		return new Date(Number(v)).toISOString().slice(0, 10);
	});
	db.function("split_part", (v: any, separator: any, index: any) => String(v).split(String(separator))[Number(index) - 1] ?? "");
	db.function("regexp_replace", (v: any, pattern: any, replacement: any) => String(v).replace(new RegExp(String(pattern)), String(replacement)));
	db.function("array_to_string", (v: any, separator: any) => JSON.parse(String(v)).join(String(separator)));
	db.function("array_length", (v: any, _dim: any) => (v == null ? null : JSON.parse(String(v)).length));
	db.function("regexp_matches_json", (value: any, pattern: any) => JSON.stringify([...String(value).matchAll(pgRegex(String(pattern), "g"))].map((m) => m[1])));
	db.function("regexp_pg", (pattern: any, value: any, insensitive: any) =>
		pattern == null || value == null ? null : Number(pgRegex(String(pattern), insensitive ? "i" : "").test(String(value))),
	);
	connection.function("lower", { deterministic: true }, (v: any) => (v == null ? null : String(v).toLowerCase()));
	connection.function("upper", { deterministic: true }, (v: any) => (v == null ? null : String(v).toUpperCase()));
	db.function("json_delete", (v: any, key: any) => {
		if (v == null) return null;
		const obj = JSON.parse(String(v));
		delete obj[String(key)];
		return JSON.stringify(obj);
	});
	db.function("jsonb_set", (v: any, path: any, value: any) => {
		if (v == null || value == null) return null;
		const obj = JSON.parse(String(v)),
			keys = String(path).slice(1, -1).split(",");
		let target = obj;
		for (const key of keys.slice(0, -1)) {
			if (!target[key]) return JSON.stringify(obj);
			target = target[key];
		}
		target[keys.at(-1)!] = JSON.parse(String(value));
		return JSON.stringify(obj);
	});
	db.function("json_concat", (a: any, b: any) => (a == null || b == null ? null : JSON.stringify({ ...JSON.parse(String(a)), ...JSON.parse(String(b)) })));
	db.function("json_text", (v: any, key: any) => {
		if (v == null || key == null) return null;
		const value = JSON.parse(String(v))[String(key)];
		return value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
	});
	db.function("boolean_value", (v: any) => (v == null ? null : Number(v === true || v === 1 || v === 1n || v === "true" || v === "1")));
	db.function("pg_like", (v: any, pattern: any, insensitive: any) => {
		if (v == null || pattern == null) return null;
		let regex = "^",
			escape = false;
		for (const char of String(pattern)) {
			if (!escape && char === "\\") {
				escape = true;
				continue;
			}
			regex += !escape && char === "%" ? ".*" : !escape && char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			escape = false;
		}
		return Number(new RegExp(regex + "$", insensitive ? "isu" : "su").test(String(v)));
	});
	let tail: Promise<unknown> = Promise.resolve();
	const context = new AsyncLocalStorage<{ active: boolean }>();
	const enqueue = <T>(run: () => T | Promise<T>): Promise<T> => {
		if (context.getStore()?.active) return Promise.resolve().then(run);
		const next = tail.then(run);
		tail = next.catch(() => {});
		return next;
	};
	// Physical columns carry SQLite type metadata. Computed columns use the
	// application's projection names to retain the same JS types as PostgreSQL.
	function decode(row: any, query: string, columns: ReturnType<ReturnType<typeof db.query>["columns"]>) {
		for (const key in row) {
			const v = row[key];
			if (v === null) continue;
			const type = columns.find((c) => c.name === key)?.type?.toLowerCase();
			if (
				type === "timestamptz" ||
				(!type && /(?:_at|_until)$/.test(key)) ||
				((key === "at" || key === "day") && /date_trunc|max\s*\([^)]*created_at|created_at\s+as\s+at|resolved_at\s+as\s+at/i.test(query))
			)
				row[key] = new Date(Number(v));
			else if (
				type === "boolean" ||
				(!type &&
					/^(?:(?:a_)?(?:followed_by_viewer|follows_viewer|requested|blocking|blocked_by|muting|notifying|reposts_muted)|following|is_member|pinning|hidden|pinned|current|own|stale|discoverable_by_email|not_interested|returning|liked|reposted|bookmarked)$/.test(
						key,
					))
			)
				row[key] = !!v;
			else if (
				typeof v === "string" &&
				(type === "jsonb" || type === "json_array" || /^(a_badges|badges|badge_ids|a_org|a_label|images|counts|users|used_by|viewer_data|explore)$/.test(key))
			)
				row[key] = JSON.parse(v);
			else if (typeof v === "bigint") row[key] = /(^|_)(id|seq|parent)$/.test(key) ? String(v) : Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
		}
		return row;
	}
	const compiled = new Map<string, string>();
	const execute = (fragment: Fragment) =>
		enqueue(() => {
			let query = compiled.get(fragment.source);
			if (!query) {
				query = sqliteSQL(fragment.source);
				if (compiled.size >= 200) compiled.delete(compiled.keys().next().value!);
				compiled.set(fragment.source, query);
			}
			try {
				const statement = db.query(query);
				const params: Record<string, any> = {};
				fragment.values.forEach((v, i) => {
					params[String(i + 1)] = v instanceof Date ? v.getTime() : typeof v === "boolean" ? Number(v) : v === undefined ? null : v;
				});
				const rows = statement.all(params).map((row) => decode(row, query, statement.columns()));
				return rows;
			} catch (error: any) {
				if (process.env.DB_DEBUG) console.error(query);
				throw error;
			}
		});
	function sql(first: any, ...values: any[]): any {
		if (!Array.isArray(first) || !("raw" in first)) {
			if (typeof first === "string") return new Fragment(quote(first), [], execute);
			return { update: first };
		}
		let source = first[0];
		const params: any[] = [];
		for (let i = 0; i < values.length; i++) {
			const value = values[i];
			if (value instanceof Fragment) {
				const offset = params.length;
				source += value.source.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\$(\d+)/g, (token, n) => (n ? `$${Number(n) + offset}` : token));
				params.push(...value.values);
			} else if (value?.update) {
				const entries = Object.entries(value.update);
				if (/\binsert\s+into\s+[\w".]+\s*$/i.test(source)) {
					const names = entries.map(([k]) => quote(k));
					const placeholders = entries.map(([, v]) => {
						params.push(v);
						return `$${params.length}`;
					});
					source += `(${names.join(", ")}) values (${placeholders.join(", ")})`;
				} else
					source += entries
						.map(([k, v]) => {
							params.push(v);
							return `${quote(k)} = $${params.length}`;
						})
						.join(", ");
			} else {
				params.push(value);
				source += `$${params.length}`;
			}
			source += first[i + 1];
		}
		return new Fragment(source, params, execute);
	}
	sql.array = (values: any[], type: string) => (/^(int8|bigint)$/i.test(type) ? JSON.stringify(values.map(String)) : JSON.stringify(values));
	sql.unsafe = (source: string, values: any[] = []) => new Fragment(source, values, execute);
	let savepoint = 0;
	sql.begin = <T>(callback: (tx: typeof sql) => Promise<T>): Promise<T> =>
		enqueue(() => {
			const nested = !!context.getStore()?.active,
				name = `xitter_${++savepoint}`;
			const scope = { active: true };
			return context.run(scope, async () => {
				db.exec(nested ? `savepoint ${name}` : "begin immediate");
				try {
					const result = await callback(sql);
					db.exec(nested ? `release ${name}` : "commit");
					return result;
				} catch (e) {
					db.exec(nested ? `rollback to ${name}; release ${name}` : "rollback");
					throw e;
				} finally {
					scope.active = false;
				}
			});
		});
	sql.close = () => enqueue(() => db.close());
	sql.end = sql.close;
	return { sql, db, enqueue };
}
