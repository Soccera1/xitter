import { openSQLite } from "../sqlite";
import { synchronizeSQLite } from "./schema-sync";
import { schema } from "../schema";

declare const self: Worker;
let connection: ReturnType<typeof openSQLite> | undefined;
self.onmessage = async ({ data: message }) => {
	try {
		let result: any;
		if (message.action === "open") {
			connection = openSQLite(message.filename);
		} else {
			if (!connection) throw new Error("SQLite worker has no open connection");
			switch (message.action) {
				case "query":
					result = await connection.execute(message.query);
					break;
				case "migrate":
					await synchronizeSQLite(connection, schema);
					break;
				case "snapshot":
					connection.db.query("vacuum into ?").run(message.path);
					break;
				case "bytes": {
					const pages = connection.db.query("pragma page_count").get() as any;
					const size = connection.db.query("pragma page_size").get() as any;
					result = String(pages.page_count * size.page_size);
					break;
				}
				case "close":
					connection.db.close();
					break;
				default:
					throw new Error(`Unknown SQLite worker action: ${message.action}`);
			}
		}
		self.postMessage({ id: message.id, result });
	} catch (error: any) {
		self.postMessage({ id: message.id, error: { name: error.name, message: error.message, stack: error.stack, code: error.code } });
	}
};
