// The shared schema describes storage, not object instances or change tracking.
export type Dialect = "postgres" | "sqlite";
export type Expression = string | Record<Dialect, string>;
export type ColumnType = "bigint" | "integer" | "smallint" | "text" | "boolean" | "timestamp" | "json" | "uuid" | "bytes" | "date" | "text[]" | "bigint[]";
export interface Column {
	type: ColumnType;
	notNull?: boolean;
	primaryKey?: boolean;
	unique?: boolean;
	default?: Expression | { value: string | number | boolean | null | unknown[] | Record<string, unknown> };
	check?: string;
	references?: { table: string; column: string; onDelete?: "cascade" | "set null" | "restrict" | "no action" };
}
export interface Table {
	columns: Record<string, Column>;
	primaryKey?: string[];
	unique?: string[][];
	checks?: string[];
}
export interface Index {
	table: string;
	expressions: string[];
	unique?: boolean;
	where?: string;
}
export interface Schema {
	tables: Record<string, Table>;
	indexes: Record<string, Index>;
	views: Record<string, Expression>;
	effects: Record<Dialect, string[]>;
}
export const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const expression = (value: Expression, dialect: Dialect) => (typeof value === "string" ? value : value[dialect]);
const types: Record<ColumnType, Record<Dialect, string>> = {
	bigint: { postgres: "bigint", sqlite: "bigint" },
	integer: { postgres: "integer", sqlite: "integer" },
	smallint: { postgres: "smallint", sqlite: "smallint" },
	text: { postgres: "text", sqlite: "text" },
	boolean: { postgres: "boolean", sqlite: "boolean" },
	timestamp: { postgres: "timestamptz", sqlite: "timestamptz" },
	json: { postgres: "jsonb", sqlite: "jsonb" },
	uuid: { postgres: "uuid", sqlite: "uuid" },
	bytes: { postgres: "bytea", sqlite: "bytea" },
	date: { postgres: "date", sqlite: "date" },
	"text[]": { postgres: "text[]", sqlite: "json_array" },
	"bigint[]": { postgres: "bigint[]", sqlite: "json_array" },
};
export const column = (type: ColumnType, options: Omit<Column, "type"> = {}): Column => ({ type, ...options });
const literal = (value: unknown): string => {
	if (value === null) return "null";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Non-finite schema default");
		return String(value);
	}
	return "'" + String(value).replaceAll("'", "''") + "'";
};
export function defaultSQL(column: Column, dialect: Dialect): string {
	const value = column.default;
	if (value === undefined) throw new Error("Column has no default");
	if (typeof value !== "object" || !("value" in value)) return expression(value, dialect);
	if (column.type.endsWith("[]")) {
		if (!Array.isArray(value.value)) throw new Error("Array default must be an array");
		return dialect === "sqlite" ? literal(JSON.stringify(value.value)) : `array[${value.value.map(literal).join(",")}]::${column.type}`;
	}
	if (column.type === "json") return literal(JSON.stringify(value.value));
	if (column.type === "timestamp" && dialect === "sqlite" && typeof value.value === "string") {
		const ms = Date.parse(value.value);
		if (!Number.isFinite(ms)) throw new Error("Invalid timestamp default");
		return String(ms);
	}
	return literal(value.value);
}
export const columnType = (column: Column, dialect: Dialect) => types[column.type][dialect];
export function columnSQL(name: string, column: Column, dialect: Dialect, foreignKeys = true, wrapDefault = true) {
	let sql = `${identifier(name)} ${columnType(column, dialect)}`;
	if (column.notNull || column.primaryKey) sql += " not null";
	if (column.primaryKey) sql += " primary key";
	if (column.unique) sql += " unique";
	if (column.default !== undefined) {
		const value = defaultSQL(column, dialect);
		sql += ` default ${wrapDefault ? `(${value})` : value}`;
	}
	if (column.check) sql += ` check (${column.check})`;
	if (column.references && foreignKeys) {
		const r = column.references;
		sql += ` references ${identifier(r.table)} (${identifier(r.column)})${r.onDelete ? ` on delete ${r.onDelete}` : ""}`;
	}
	return sql;
}
export function tableSQL(name: string, table: Table, dialect: Dialect, foreignKeys = true) {
	const clauses = Object.entries(table.columns).map(([name, column]) => columnSQL(name, column, dialect, foreignKeys));
	if (table.primaryKey) clauses.push(`primary key (${table.primaryKey.map(identifier).join(", ")})`);
	for (const columns of table.unique ?? []) clauses.push(`unique (${columns.map(identifier).join(", ")})`);
	for (const check of table.checks ?? []) clauses.push(`check (${check})`);
	return `create table ${identifier(name)} (${clauses.join(", ")})`;
}
export function indexSQL(name: string, index: Index) {
	return `create ${index.unique ? "unique " : ""}index ${identifier(name)} on ${identifier(index.table)} (${index.expressions.join(", ")})${index.where ? ` where ${index.where}` : ""}`;
}
