import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { openSQLite } from "../sqlite";
import { columnSQL, columnType, defaultSQL, expression, identifier as q, indexSQL, tableSQL, type Schema, type Table } from "./schema-types";
import { migrations, type Migration } from "./migrations";

export const HISTORY = "_xitter_schema_history";
const fingerprint = (schema: Schema) => createHash("sha256").update(JSON.stringify(schema)).digest("hex");
const initial = JSON.parse(readFileSync(join(import.meta.dir, "migrations/001-schema.json"), "utf8")) as Schema;
const bootstrap = (dialect: string) => readFileSync(join(import.meta.dir, `migrations/${dialect}/001-initial.sql`), "utf8");
const historyDDL = `create table if not exists ${q(HISTORY)} (version integer primary key, fingerprint text not null, schema_json text not null, statements text not null, migration_id text, created_at text not null)`;

// SQL is used only to describe expressions supplied by the schema author. Never
// infer a rename from similar names, or remove an unexpected column/table.
function validateSchema(schema: Schema) {
	for (const [name, table] of Object.entries(schema.tables)) {
		if (name.startsWith("_xitter_")) throw new Error(`Reserved schema table name: ${name}`);
		for (const key of [...(table.primaryKey ?? []), ...(table.unique ?? []).flat()])
			if (!table.columns[key]) throw new Error(`Unknown key column ${name}.${key}`);
		for (const [column, definition] of Object.entries(table.columns))
			if (definition.references) {
				const r = definition.references,
					target = schema.tables[r.table];
				if (!target?.columns[r.column]) throw new Error(`Unknown foreign key target ${name}.${column} -> ${r.table}.${r.column}`);
				const key = target.columns[r.column];
				if (!key.primaryKey && !key.unique && !same(target.primaryKey, [r.column]) && !(target.unique ?? []).some((cols) => same(cols, [r.column])))
					throw new Error(`Foreign key target is not unique: ${r.table}.${r.column}`);
			}
	}
	for (const [name, index] of Object.entries(schema.indexes))
		if (!schema.tables[index.table]) throw new Error(`Unknown table for index ${name}: ${index.table}`);
}
function removal(name: string): never {
	throw new Error(`Schema sync would remove ${name}; add an explicit migration that preserves or deliberately removes its data`);
}
function safeType(oldType: string, newType: string, name: string) {
	if (oldType !== newType && !(oldType === "integer" && newType === "bigint") && !(oldType === "smallint" && ["integer", "bigint"].includes(newType))) {
		throw new Error(`Schema sync cannot convert ${name} from ${oldType} to ${newType}; add an explicit data migration`);
	}
}
function noDowngrade(rows: any[], hash: string) {
	const revisions = rows.filter((r) => r.migration_id == null);
	if (revisions.length && revisions.at(-1).fingerprint !== hash && revisions.some((r) => r.fingerprint === hash))
		throw new Error("Schema belongs to an older version of Xitter; refusing an automatic downgrade");
}
function validateMigrations(rows: any[], upgrades: Migration[], dialect: "sqlite" | "postgres") {
	if (new Set(upgrades.map((m) => m.id)).size !== upgrades.length) throw new Error("Duplicate explicit migration ID");
	const applied = rows.filter((r) => r.migration_id != null);
	for (let i = 0; i < applied.length; i++) {
		const migration = upgrades[i];
		if (!migration || migration.id !== applied[i].migration_id) throw new Error("Released migrations cannot be removed or reordered");
		if (!same(JSON.parse(applied[i].statements), migration.up[dialect])) throw new Error(`Released migration ${migration.id} was modified`);
	}
}
function sqlTokens(sql: string): string[] {
	return sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\w+|<>|!=|<=|>=|\|\||[^\s]/g) ?? [];
}
function normal(sql: string | null | undefined): string {
	if (sql == null) return "";
	let tokens = sqlTokens(sql).map((t) => (t.startsWith("'") ? t : t.replace(/^"|"$/g, "").toLowerCase()));
	while (tokens[0] === "(" && tokens.at(-1) === ")") {
		let depth = 0,
			outer = true;
		for (let i = 0; i < tokens.length - 1; i++) {
			if (tokens[i] === "(") depth++;
			if (tokens[i] === ")") depth--;
			if (!depth) {
				outer = false;
				break;
			}
		}
		if (!outer) break;
		tokens = tokens.slice(1, -1);
	}
	return tokens.join(" ");
}
function checks(sql: string) {
	const tokens = sqlTokens(sql),
		result: string[] = [];
	for (let i = 0; i < tokens.length; i++)
		if (tokens[i].toLowerCase() === "check" && tokens[i + 1] === "(") {
			let depth = 1,
				start = i + 2;
			i += 2;
			while (i < tokens.length && depth) {
				if (tokens[i] === "(") depth++;
				if (tokens[i] === ")") depth--;
				i++;
			}
			result.push(normal(tokens.slice(start, i - 1).join(" ")));
		}
	return result.sort();
}
function sqliteShape(db: ReturnType<typeof openSQLite>["db"], name: string) {
	const columns = db.query(`pragma table_info(${q(name)})`).all() as any[];
	const foreign = (db.query(`pragma foreign_key_list(${q(name)})`).all() as any[]).map((r) => [r.from, r.table, r.to, r.on_delete, r.on_update]).sort();
	const unique = (db.query(`pragma index_list(${q(name)})`).all() as any[])
		.filter((r) => r.origin === "u")
		.map((r) => (db.query(`pragma index_info(${q(r.name)})`).all() as any[]).map((c) => c.name).join(","))
		.sort();
	const source = (db.query("select sql from sqlite_master where type = 'table' and name = ?").get(name) as any)?.sql ?? "";
	return {
		columns: Object.fromEntries(
			columns.map((c) => [
				c.name,
				{ type: c.type.toLowerCase().replace(/^int$/, "integer"), notNull: !!c.notnull, pk: Number(c.pk), default: normal(c.dflt_value) },
			]),
		) as Record<string, { type: string; notNull: boolean; pk: number; default: string }>,
		foreign,
		unique,
		checks: checks(source),
	};
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Synchronous runner: called while holding the connection's exclusive queue. */
export async function synchronizeSQLite(sqlite: ReturnType<typeof openSQLite>, desired: Schema, upgrades: Migration[] = migrations) {
	validateSchema(desired);
	const { db } = sqlite,
		hash = fingerprint(desired);
	db.exec("begin");
	try {
		const ledgerExists = !!db.query("select 1 from sqlite_master where type = 'table' and name = ?").get(HISTORY);
		const version = Number((db.query("pragma user_version").get() as any).user_version);
		if (!ledgerExists && version > 1) throw new Error("SQLite database was created by a newer version of Xitter");
		if (ledgerExists) {
			const latest = db.query(`select version,fingerprint from ${q(HISTORY)} order by version desc limit 1`).get() as any;
			const applied = db.query(`select * from ${q(HISTORY)} where migration_id is not null order by version`).all() as any[];
			if (Number(latest?.version) !== version) throw new Error("SQLite schema version does not match migration history");
			validateMigrations(applied, upgrades, "sqlite");
			if (latest?.fingerprint === hash && upgrades.every((m) => applied.some((r) => r.migration_id === m.id))) {
				db.exec("commit");
				return;
			}
		}
		db.exec("commit");
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
	const foreignKeys = Number((db.query("pragma foreign_keys").get() as any).foreign_keys);
	const legacyAlter = Number((db.query("pragma legacy_alter_table").get() as any).legacy_alter_table);
	const { openSQLite } = await import("../sqlite");
	const reference = openSQLite(":memory:");
	try {
		for (const [name, table] of Object.entries(desired.tables)) reference.db.exec(tableSQL(name, table, "sqlite"));
		for (const [name, index] of Object.entries(desired.indexes)) reference.db.exec(indexSQL(name, index));
		db.exec("pragma foreign_keys = off; pragma legacy_alter_table = on; begin immediate");
		try {
			db.exec(historyDDL);
			let rows = db.query(`select * from ${q(HISTORY)} order by version`).all() as any[];
			const record = (model: Schema, statements: string[], migration: string | null = null) => {
				const next = Number(rows.at(-1)?.version ?? 0) + 1;
				db.query(`insert into ${q(HISTORY)} (version,fingerprint,schema_json,statements,migration_id,created_at) values (?,?,?,?,?,?)`).run(
					next,
					fingerprint(model),
					JSON.stringify(model),
					JSON.stringify(statements),
					migration,
					new Date().toISOString(),
				);
				db.exec(`pragma user_version = ${next}`);
				rows.push({
					version: next,
					fingerprint: fingerprint(model),
					schema_json: JSON.stringify(model),
					migration_id: migration,
					statements: JSON.stringify(statements),
				});
			};
			if (!rows.length) {
				db.exec(bootstrap("sqlite"));
				record(initial, ["001-initial.sql"]);
			}
			noDowngrade(rows, hash);
			validateMigrations(rows, upgrades, "sqlite");
			const previous = JSON.parse(rows.filter((r) => r.migration_id == null).at(-1).schema_json) as Schema;
			const statements: string[] = [];
			const run = (sql: string) => {
				db.exec(sql);
				statements.push(sql);
			};
			for (const migration of upgrades)
				if (!rows.some((r) => r.migration_id === migration.id)) {
					for (const statement of migration.up.sqlite) run(statement);
					record(previous, migration.up.sqlite, migration.id);
				}
			for (const name of Object.keys(previous.tables))
				if (!desired.tables[name] && db.query("select 1 from sqlite_master where type = 'table' and name = ?").get(name)) removal(`table ${name}`);
			const rebuild: [string, Table, string[]][] = [];
			for (const [name, table] of Object.entries(desired.tables)) {
				const actual = sqliteShape(db, name),
					target = sqliteShape(reference.db, name);
				if (!Object.keys(actual.columns).length) {
					run(tableSQL(name, table, "sqlite"));
					continue;
				}
				for (const column of Object.keys(actual.columns)) if (!table.columns[column]) removal(`${name}.${column}`);
				for (const [column, definition] of Object.entries(actual.columns)) safeType(definition.type, target.columns[column].type, `${name}.${column}`);
				if (!same(actual, target)) {
					const added = Object.keys(target.columns).filter((c) => !actual.columns[c]);
					const remainingChecks = [...target.checks];
					for (const column of added)
						if (table.columns[column].check) {
							const position = remainingChecks.indexOf(normal(table.columns[column].check));
							if (position >= 0) remainingChecks.splice(position, 1);
						}
					const constantDefault = (column: string) => {
						const definition = table.columns[column];
						if (definition.primaryKey || definition.unique) return false;
						if (definition.default === undefined) return true;
						return /^(?:'(?:''|[^'])*'|[+-]?\d+(?:\.\d+)?|true|false|null)$/i.test(normal(defaultSQL(definition, "sqlite")));
					};
					const additive =
						added.length &&
						added.every(constantDefault) &&
						Object.keys(actual.columns).every((c) => same(actual.columns[c], target.columns[c])) &&
						same(
							actual.foreign,
							target.foreign.filter((r) => !added.includes(r[0])),
						) &&
						same(actual.unique, target.unique) &&
						same(actual.checks, remainingChecks);
					if (additive) for (const column of added) run(`alter table ${q(name)} add column ${columnSQL(column, table.columns[column], "sqlite", true, false)}`);
					else rebuild.push([name, table, Object.keys(actual.columns)]);
				}
			}
			// Views and triggers must not observe half-rebuilt tables or change counters
			// during the copy. Preserve user-created objects as well as managed objects.
			const saved = db.query("select type,name,sql from sqlite_master where type in ('trigger','view') and sql is not null").all() as any[];
			if (rebuild.length) {
				for (const object of saved) run(`drop ${object.type} ${q(object.name)}`);
				for (const [name, table, columns] of rebuild) {
					const temporary = `_xitter_rebuild_${name}`;
					if (db.query("select 1 from sqlite_master where name = ?").get(temporary)) throw new Error(`Temporary schema object already exists: ${temporary}`);
					const indexes = db.query("select name,sql from sqlite_master where type = 'index' and tbl_name = ? and sql is not null").all(name) as any[];
					run(tableSQL(temporary, table, "sqlite"));
					run(`insert into ${q(temporary)} (${columns.map(q).join(",")}) select ${columns.map(q).join(",")} from ${q(name)}`);
					run(`drop table ${q(name)}`);
					run(`alter table ${q(temporary)} rename to ${q(name)}`);
					for (const index of indexes) if (!desired.indexes[index.name] && !previous.indexes[index.name]) run(index.sql);
				}
			}
			for (const name of Object.keys(previous.indexes)) if (!desired.indexes[name]) run(`drop index if exists ${q(name)}`);
			for (const [name, index] of Object.entries(desired.indexes)) {
				const actual = (db.query("select sql from sqlite_master where type = 'index' and name = ?").get(name) as any)?.sql;
				const target = indexSQL(name, index);
				if (!actual || normal(actual.replace(/if not exists/gi, "")) !== normal(target)) {
					if (actual) run(`drop index ${q(name)}`);
					run(target);
				}
			}
			const effectsChanged = !same(previous.effects.sqlite, desired.effects.sqlite);
			if (rebuild.length || effectsChanged) {
				for (const effect of previous.effects.sqlite) {
					const name = /create trigger (?:if not exists )?(\w+)/i.exec(effect)?.[1];
					if (name) run(`drop trigger if exists ${q(name)}`);
				}
			}
			if (rebuild.length || effectsChanged) for (const effect of desired.effects.sqlite) run(effect);
			for (const [name, view] of Object.entries(desired.views)) {
				const actual = (db.query("select sql from sqlite_master where type = 'view' and name = ?").get(name) as any)?.sql;
				const target = `create view ${q(name)} as ${expression(view, "sqlite")}`;
				if (!actual || normal(actual.replace(/if not exists/gi, "")) !== normal(target)) {
					if (actual) run(`drop view ${q(name)}`);
					run(target);
				}
			}
			for (const name of Object.keys(previous.views)) if (!desired.views[name]) run(`drop view if exists ${q(name)}`);
			if (rebuild.length)
				for (const object of saved) {
					const managed =
						object.type === "view"
							? !!previous.views[object.name]
							: previous.effects.sqlite.some((s) => new RegExp(`create trigger (?:if not exists )?${object.name}\\b`, "i").test(s));
					if (!managed) run(object.sql);
				}
			for (const name of Object.keys(desired.views)) db.query(`select * from ${q(name)} limit 0`).all();
			if (rebuild.length)
				for (const object of saved) if (object.type === "view" && !previous.views[object.name]) db.query(`select * from ${q(object.name)} limit 0`).all();
			if ((db.query("pragma foreign_key_check").all() as any[]).length) throw new Error("Schema synchronization would violate foreign keys");
			if (rows.at(-1).fingerprint !== hash || statements.length) record(desired, statements);
			db.exec("commit");
		} catch (error) {
			db.exec("rollback");
			throw error;
		}
	} finally {
		reference.db.close();
		db.exec(`pragma foreign_keys = ${foreignKeys}; pragma legacy_alter_table = ${legacyAlter}`);
	}
}

// PostgreSQL compares parsed catalog definitions from temporary shape tables,
// rather than attempting to normalize PostgreSQL's SQL deparser with regexes.
export async function synchronizePostgres(sql: any, desired: Schema, upgrades: Migration[] = migrations) {
	validateSchema(desired);
	await sql.begin(async (tx: any) => {
		await tx.unsafe("set local statement_timeout = 0");
		await tx.unsafe("set local lock_timeout = 0");
		await tx`select pg_advisory_xact_lock(814247119)`;
		await tx.unsafe(historyDDL);
		let rows = await tx.unsafe(`select * from ${q(HISTORY)} order by version`);
		const record = async (model: Schema, statements: string[], migration: string | null = null) => {
			const next = Number(rows.at(-1)?.version ?? 0) + 1;
			await tx.unsafe(`insert into ${q(HISTORY)} (version,fingerprint,schema_json,statements,migration_id,created_at) values ($1,$2,$3,$4,$5,$6)`, [
				next,
				fingerprint(model),
				JSON.stringify(model),
				JSON.stringify(statements),
				migration,
				new Date().toISOString(),
			]);
			rows.push({
				version: next,
				fingerprint: fingerprint(model),
				schema_json: JSON.stringify(model),
				migration_id: migration,
				statements: JSON.stringify(statements),
			});
		};
		if (!rows.length) {
			await tx.unsafe(bootstrap("postgres"));
			await record(initial, ["001-initial.sql"]);
		}
		const hash = fingerprint(desired);
		noDowngrade(rows, hash);
		validateMigrations(rows, upgrades, "postgres");
		if (rows.at(-1).fingerprint === hash && upgrades.every((m) => rows.some((r: any) => r.migration_id === m.id))) return;
		const previous = JSON.parse(rows.filter((r: any) => r.migration_id == null).at(-1).schema_json) as Schema;
		const statements: string[] = [];
		const run = async (statement: string) => {
			await tx.unsafe(statement);
			statements.push(statement);
		};
		for (const migration of upgrades)
			if (!rows.some((r: any) => r.migration_id === migration.id)) {
				for (const statement of migration.up.postgres) await run(statement);
				await record(previous, migration.up.postgres, migration.id);
			}
		const columns = async (name: string) =>
			await tx.unsafe(
				`select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,pg_get_expr(d.adbin,d.adrelid) as default from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass($1) and a.attnum>0 and not a.attisdropped order by a.attnum`,
				[name],
			);
		const constraints = async (name: string) =>
			await tx.unsafe(
				`select c.conname as name,c.contype as type,pg_get_constraintdef(c.oid,true) as definition from pg_constraint c where c.conrelid=to_regclass($1) order by c.contype,c.conname`,
				[name],
			);
		for (const name of Object.keys(previous.tables)) if (!desired.tables[name] && (await columns(name)).length) removal(`table ${name}`);
		for (const [name, table] of Object.entries(desired.tables)) if (!(await columns(name)).length) await run(tableSQL(name, table, "postgres", false));
		const foreignKeysToAdd: string[] = [];
		for (const [name, table] of Object.entries(desired.tables)) {
			const shape = `_xitter_shape_${name}`;
			const actual = await columns(name);
			for (const old of actual) {
				const column = table.columns[old.name];
				if (!column) removal(`${name}.${old.name}`);
				const targetType = columnType(column, "postgres").replace(/^timestamptz$/, "timestamp with time zone");
				safeType(old.type, targetType, `${name}.${old.name}`);
			}
			await tx.unsafe(tableSQL(shape, table, "postgres", false).replace("create table", "create temporary table") + " on commit drop");
			const target = await columns(`pg_temp.${shape}`);
			for (const column of actual) if (!table.columns[column.name]) removal(`${name}.${column.name}`);
			for (const wanted of target) {
				const old = actual.find((c: any) => c.name === wanted.name),
					column = table.columns[wanted.name];
				if (!old) {
					await run(`alter table ${q(name)} add column ${columnSQL(wanted.name, column, "postgres")}`);
					continue;
				}
				safeType(old.type, wanted.type, `${name}.${wanted.name}`);
				if (old.type !== wanted.type) await run(`alter table ${q(name)} alter column ${q(wanted.name)} type ${columnType(column, "postgres")}`);
				if (old.default !== wanted.default)
					await run(
						`alter table ${q(name)} alter column ${q(wanted.name)} ${column.default === undefined ? "drop default" : `set default ${defaultSQL(column, "postgres")}`}`,
					);
				if (old.not_null !== wanted.not_null) await run(`alter table ${q(name)} alter column ${q(wanted.name)} ${wanted.not_null ? "set" : "drop"} not null`);
			}
			const existing = await constraints(name),
				expected = await constraints(`pg_temp.${shape}`);
			for (const [column, definition] of Object.entries(table.columns))
				if (definition.references) {
					const r = definition.references;
					expected.push({
						name: `${name}_${column}_fkey`,
						type: "f",
						definition: `foreign key (${q(column)}) references ${q(r.table)} (${q(r.column)})${r.onDelete ? ` on delete ${r.onDelete}` : ""}`,
					});
				}
			for (const c of existing)
				if (!expected.some((e: any) => e.type === c.type && normal(e.definition) === normal(c.definition)))
					await run(`alter table ${q(name)} drop constraint ${q(c.name)}`);
			for (const c of expected)
				if (!existing.some((e: any) => e.type === c.type && normal(e.definition) === normal(c.definition))) {
					const statement = `alter table ${q(name)} add constraint ${q(c.name.replace(shape, name))} ${c.definition}`;
					if (c.type === "f") foreignKeysToAdd.push(statement);
					else await run(statement);
				}
			await tx.unsafe(`drop table ${q(shape)}`);
		}
		for (const statement of foreignKeysToAdd) await run(statement);
		for (const name of Object.keys(previous.indexes)) if (!desired.indexes[name]) await run(`drop index if exists ${q(name)}`);
		const pgIndex = async (name: string) =>
			(
				await tx.unsafe(
					`select i.indrelid::regclass::text as table_name,i.indisunique as unique,pg_get_expr(i.indpred,i.indrelid) as predicate,array(select pg_get_indexdef(i.indexrelid,k,true) from generate_series(1,i.indnatts) k) as expressions from pg_index i where i.indexrelid=to_regclass($1)`,
					[name],
				)
			)[0];
		for (const [name, index] of Object.entries(desired.indexes)) {
			const shape = `_xitter_index_${name}`;
			await tx.unsafe(indexSQL(shape, index));
			const expected = await pgIndex(shape),
				actual = await pgIndex(name);
			await tx.unsafe(`drop index ${q(shape)}`);
			if (!same(actual, expected)) {
				if (actual) await run(`drop index ${q(name)}`);
				await run(indexSQL(name, index));
			}
		}
		for (const name of Object.keys(previous.views)) if (!desired.views[name]) await run(`drop view if exists ${q(name)}`);
		if (!same(previous.views, desired.views))
			for (const [name, view] of Object.entries(desired.views)) await run(`create or replace view ${q(name)} as ${expression(view, "postgres")}`);
		if (!same(previous.effects.postgres, desired.effects.postgres)) for (const effect of desired.effects.postgres) await run(effect);
		if (rows.at(-1).fingerprint !== hash || statements.length) await record(desired, statements);
	});
}
