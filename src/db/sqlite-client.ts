import { ArrayValue, createSQL, type CompiledQuery } from "./query";
import { serialDriver } from "./serial-driver";

// The HTTP thread never imports node:sqlite or runs native database work.
export function sqliteClient(filename: string) {
	// Bun adds lifecycle controls to the standard DOM Worker interface.
	const worker = new Worker(new URL("./sqlite-worker.ts", import.meta.url).href) as Worker & Pick<Bun.Worker, "ref" | "unref">;
	let id = 0;
	let failure: Error | undefined;
	let closing = false;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	const fail = (error: Error) => {
		failure = error;
		for (const request of pending.values()) request.reject(error);
		pending.clear();
		worker.unref();
	};
	worker.onmessage = ({ data }) => {
		const request = pending.get(data.id);
		if (!request) return;
		pending.delete(data.id);
		if (!pending.size) worker.unref();
		if (data.error) request.reject(Object.assign(new Error(data.error.message), data.error));
		else request.resolve(data.result);
	};
	worker.onerror = (event) => {
		event.preventDefault();
		fail(new Error(event.message || "SQLite worker failed"));
	};
	worker.addEventListener("close", () => {
		if (!closing) fail(new Error("SQLite worker exited unexpectedly"));
	});
	function request(action: string, args: Record<string, any> = {}): Promise<any> {
		if (failure) return Promise.reject(failure);
		if (closing) return Promise.reject(new Error("SQLite connection is closed"));
		return new Promise((resolve, reject) => {
			const sequence = ++id;
			worker.ref();
			pending.set(sequence, { resolve, reject });
			try {
				worker.postMessage({ id: sequence, action, ...args });
			} catch (error) {
				pending.delete(sequence);
				if (!pending.size) worker.unref();
				reject(error);
			}
		});
	}
	const ready = request("open", { filename });
	// Handle startup errors even if the first application query comes later.
	ready.catch(() => {});
	const { driver, enqueue } = serialDriver(
		async (query: CompiledQuery) => {
			await ready;
			// Class prototypes are not retained by structured clone.
			const values = query.values.map((value) =>
				value instanceof ArrayValue
					? JSON.stringify(/^(int8|bigint)$/i.test(value.type) ? value.values.map((item) => (item == null ? null : String(item))) : value.values)
					: value,
			);
			return request("query", { query: { ...query, values } });
		},
		async () => {
			try {
				await ready;
				await request("close");
			} finally {
				closing = true;
				worker.terminate();
				fail(new Error("SQLite connection is closed"));
			}
		},
	);
	const operation = (action: string, args = {}) =>
		enqueue(async () => {
			await ready;
			return request(action, args);
		});
	return {
		sql: createSQL(driver, "sqlite"),
		migrate: () => operation("migrate"),
		snapshot: (path: string) => operation("snapshot", { path }),
		bytes: (): Promise<string> => operation("bytes"),
	};
}
