import { AsyncLocalStorage } from "node:async_hooks";
import type { Driver, CompiledQuery } from "./query";

// A transaction holds the queue across awaits. Unrelated requests cannot use
// its connection, and work spawned after the callback finishes rejoins the queue.
export function serialDriver(execute: (query: CompiledQuery) => Promise<any[]>, close: () => Promise<void>) {
	let tail: Promise<unknown> = Promise.resolve();
	let sequence = 0;
	const context = new AsyncLocalStorage<{ active: boolean }>();
	function enqueue<T>(run: () => Promise<T>): Promise<T> {
		if (context.getStore()?.active) return Promise.resolve().then(run);
		const next = tail.then(run);
		tail = next.catch(() => {});
		return next;
	}
	const command = async (text: string) => {
		await execute({ text, values: [] });
	};
	const driver: Driver = {
		execute: (query) => enqueue(() => execute(query)),
		close: () => enqueue(close),
		begin: (callback) =>
			enqueue(async () => {
				const nested = !!context.getStore()?.active;
				const name = `xitter_${++sequence}`;
				const scope = { active: true };
				return context.run(scope, async () => {
					await command(nested ? `savepoint ${name}` : "begin immediate");
					try {
						const result = await callback(driver);
						await command(nested ? `release ${name}` : "commit");
						return result;
					} catch (error) {
						await command(nested ? `rollback to ${name}` : "rollback");
						if (nested) await command(`release ${name}`);
						throw error;
					} finally {
						scope.active = false;
					}
				});
			}),
	};
	return { driver, enqueue };
}
