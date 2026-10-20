import { SQL } from "bun";
import { ArrayValue, createSQL, decodeFields, type Driver } from "./query";

export function postgresDriver(connection: SQL, nested = false): Driver {
	return {
		execute: async ({ text, values, fields }) => {
			try {
				const rows = await connection.unsafe(
					text,
					values.map((value) => (value instanceof ArrayValue ? connection.array(value.values, value.type) : value === undefined ? null : value)),
				);
				// Bun has already decoded PostgreSQL JSON, including scalar strings.
				return decodeFields(rows, fields, false);
			} catch (error) {
				if (process.env.DB_DEBUG) console.error(text);
				throw error;
			}
		},
		begin: (callback) =>
			nested
				? (connection as unknown as Bun.TransactionSQL).savepoint((tx) => callback(postgresDriver(tx, true)))
				: connection.begin((tx) => callback(postgresDriver(tx, true))),
		close: async () => {
			await connection.close();
		},
	};
}
export const postgresQueries = (connection: SQL) => createSQL(postgresDriver(connection), "postgres");
