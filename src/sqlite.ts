// Native SQLite connection. Only the worker and isolated migration tests import this.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ArrayValue, createSQL, decodeFields, type CompiledQuery } from "./db/query";
import { serialDriver } from "./db/serial-driver";

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
	db.function("iso_timestamp", (v: any) => v == null ? null : new Date(Number(v)).toISOString());
	db.function("sha256_hex", (v: any) => v == null ? null : new Bun.CryptoHasher("sha256").update(v).digest("hex"));
	db.function("json_has", (v: any, key: any) => {
		if (v == null) return null;
		const parsed = JSON.parse(String(v));
		return Number(Array.isArray(parsed) ? parsed.includes(String(key)) : parsed !== null && typeof parsed === "object" && Object.hasOwn(parsed, String(key)));
	});
	db.function("json_type_pg", (v: any) => {
		if (v == null) return null;
		const parsed = JSON.parse(String(v));
		return parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
	});
	db.function("translate", (v: any, from: any, to: any) => v == null ? null : [...String(v)].map(c => {
		const i = String(from).indexOf(c); return i < 0 ? c : [...String(to)][i] ?? "";
	}).join(""));
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
		if (v == null || key == null) return null;
		const obj = JSON.parse(String(v));
		if (obj === null || typeof obj !== "object") throw new Error("Cannot delete from scalar JSON");
		if (Array.isArray(obj)) {
			if (typeof key === "bigint" || typeof key === "number") {
				const index = Number(key) < 0 ? obj.length + Number(key) : Number(key);
				if (index >= 0 && index < obj.length) obj.splice(index, 1);
				return JSON.stringify(obj);
			}
			return JSON.stringify(obj.filter((value) => value !== String(key)));
		}
		if (typeof key !== "string") throw new Error("Cannot delete an integer index from a JSON object");
		delete obj[String(key)];
		return JSON.stringify(obj);
	});
	db.function("jsonb_set", (v: any, path: any, value: any) => {
		if (v == null || path == null || value == null) return null;
		const obj = JSON.parse(String(v)),
			keys: string[] = String(path).startsWith("[") ? JSON.parse(String(path)) : String(path) === "{}" ? [] : String(path).slice(1, -1).split(",");
		if (!keys.length) return JSON.stringify(obj);
		if (obj === null || typeof obj !== "object") throw new Error("Cannot set a path in scalar JSON");
		let target = obj;
		for (const part of keys.slice(0, -1)) {
			if (target === null || typeof target !== "object") return JSON.stringify(obj);
			const key = Array.isArray(target) && Number(part) < 0 ? target.length + Number(part) : part;
			if (!Object.hasOwn(target, key)) return JSON.stringify(obj);
			target = target[key];
		}
		if (target === null || typeof target !== "object") return JSON.stringify(obj);
		const last = keys.at(-1)!,
			replacement = JSON.parse(String(value));
		if (Array.isArray(target)) {
			if (!/^-?\d+$/.test(last)) throw new Error("JSON array path must be an integer");
			const index = Number(last) < 0 ? target.length + Number(last) : Number(last);
			if (index < 0) target.unshift(replacement);
			else if (index >= target.length) target.push(replacement);
			else target[index] = replacement;
		} else Object.defineProperty(target, last, { value: replacement, enumerable: true, configurable: true, writable: true });
		return JSON.stringify(obj);
	});
	db.function("json_concat", (a: any, b: any) => {
		if (a == null || b == null) return null;
		const left = JSON.parse(String(a)),
			right = JSON.parse(String(b));
		const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
		return JSON.stringify(
			object(left) && object(right) ? { ...left, ...right } : [...(Array.isArray(left) ? left : [left]), ...(Array.isArray(right) ? right : [right])],
		);
	});
	function jsonMember(v: any, key: any) {
		if (v == null || key == null) return undefined;
		const obj = JSON.parse(String(v));
		if (obj === null || typeof obj !== "object") return undefined;
		if (Array.isArray(obj) && typeof key === "string") return undefined;
		if (!Array.isArray(obj) && typeof key !== "string") return undefined;
		const index = Array.isArray(obj) && Number(key) < 0 ? obj.length + Number(key) : String(key);
		return Object.hasOwn(obj, index) ? obj[index] : undefined;
	}
	db.function("json_get", (v: any, key: any) => {
		const value = jsonMember(v, key);
		return value === undefined ? null : JSON.stringify(value);
	});
	db.function("json_text", (v: any, key: any) => {
		const value = jsonMember(v, key);
		return value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
	});
	db.function("boolean_value", (v: any) => {
		if (v == null) return null;
		if (typeof v !== "string") return Number(v !== 0 && v !== 0n && v !== false);
		const input = v.trim().toLowerCase();
		if (/^(t(r(u(e)?)?)?|y(e(s)?)?|on|1)$/.test(input)) return 1;
		if (/^(f(a(l(s(e)?)?)?)?|n(o)?|of(f)?|0)$/.test(input)) return 0;
		throw new Error("Invalid boolean value");
	});
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
		if (escape) throw new Error("LIKE pattern must not end with an escape character");
		return Number(new RegExp(regex + "$", insensitive ? "isu" : "su").test(String(v)));
	});
	// Physical columns carry SQLite type metadata. Computed columns use the
	// application's projection names to retain the same JS types as PostgreSQL.
	function decode(row: any, query: string, columns: ReturnType<ReturnType<typeof db.query>["columns"]>, fields: CompiledQuery["fields"]) {
		for (const key in row) {
			const v = row[key];
			if (v === null || fields?.[key]) continue;
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
	const execute = async ({ text: query, values, fields }: CompiledQuery) => {
		try {
			const statement = db.query(query);
			const params: Record<string, any> = {};
			values.forEach((v, i) => {
				params[String(i + 1)] =
					v instanceof ArrayValue
						? JSON.stringify(/^(int8|bigint)$/i.test(v.type) ? v.values.map((item) => (item == null ? null : String(item))) : v.values)
						: v instanceof Date
							? v.getTime()
							: typeof v === "boolean"
								? Number(v)
								: v === undefined
									? null
									: v;
			});
			const columns = statement.columns();
			return decodeFields(
				statement.all(params).map((row) => decode(row, query, columns, fields)),
				fields,
			);
		} catch (error) {
			if (process.env.DB_DEBUG) console.error(query);
			throw error;
		}
	};
	const { driver, enqueue } = serialDriver(execute, async () => db.close());
	return { sql: createSQL(driver, "sqlite"), db, enqueue, execute };
}
