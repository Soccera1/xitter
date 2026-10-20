// Disposable end-to-end checks: the same server and feature tests on each backend.
import { SQL } from "bun";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const directory = mkdtempSync(join(tmpdir(), "xitter-backends-"));
mkdirSync(join(directory, "client/abs/responsive-web/client-web"), { recursive: true });
// Exercise the generated HTML without downloading or executing a client bundle.
writeFileSync(
	join(directory, "client/build.json"),
	JSON.stringify({
		sha: "database-test",
		scripts: [],
		meta: {},
		fetchedAt: new Date(0).toISOString(),
		featureSwitch: { defaultConfig: {}, config: {}, featureSetToken: "", settingsVersion: "" },
	}),
);
writeFileSync(join(directory, "client/runtime.js"), "");
cpSync(join(root, "public"), join(directory, "public"), { recursive: true });
const password = "backend-test-password";
const names = ["backend_a", "backend_b", "backend_c", "backend_d"];
const image = join(directory, "pixel.png");
writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const suites: [string, string[]][] = [
	["polls", [names[0], names[1], password]],
	["notifications", [names[0], names[1], password]],
	["analytics", [names[0], names[1], password]],
	["blocks", [names[0], names[1], password]],
	["lists", [names[0], names[1], password]],
	["communities", [names[0], names[1], password]],
	["edits", [names[0], names[1], password]],
	["views", [names[0], names[1], password]],
	["ranking", [names[0], names[1], password]],
	["search", [names[0], names[1], password, image]],
	["contacts", [...names, password]],
	["trends", []],
	["account-settings", []],
	["delegation", [names[0], names[1], names[2], password]],
	["threads", []],
	["chat", []],
	["topics", ["backend_owner", names[0], names[1], password]],
	["admin", ["backend_owner", names[0], names[2], password]],
	["notes", ["backend_owner", names[1], password]],
];
async function run(args: string[], env: Record<string, string | undefined>) {
	const child = Bun.spawn([process.execPath, ...args], { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
	const timer = setTimeout(() => child.kill(), 90_000);
	try {
		const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		if (code) throw new Error(`${args[0]} failed (${code})\n${stdout}\n${stderr}`);
		return stdout;
	} finally {
		clearTimeout(timer);
	}
}

try {
	for (const backend of ["sqlite", "postgres"] as const) {
		if (backend === "postgres" && !process.env.TEST_POSTGRES_URL) {
			console.log("skip postgres: set TEST_POSTGRES_URL to enable");
			continue;
		}
		let admin: SQL | undefined;
		let databaseName: string | undefined;
		let databaseURL = `sqlite://${join(directory, "app.sqlite")}`;
		if (backend === "postgres") {
			const url = new URL(process.env.TEST_POSTGRES_URL!);
			admin = new SQL(url.href);
			databaseName = `xitter_features_${process.pid}`;
			await admin.unsafe(`create database "${databaseName}"`);
			url.pathname = `/${databaseName}`;
			databaseURL = url.href;
		}
		// Ask the OS for a free port, then hand it to the child server.
		const probe = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = probe.port!;
		await probe.stop(true);
		const env = {
			...process.env,
			DATABASE_URL: databaseURL,
			PORT: String(port),
			TEST_ORIGIN: `http://localhost:${port}`,
			PUBLIC_ORIGIN: `http://localhost:${port}`,
			PUBLIC_DIR: join(directory, "public"),
			CLIENT_DIR: join(directory, "client"),
			BRANDING_DIR: join(directory, backend, "branding"),
			MEDIA_DIR: join(directory, backend, "media"),
			BACKUP_DIR: join(directory, backend, "backups"),
			DB_DEBUG: "1",
			RATE_LIMITS: "off",
		};
		let server: ReturnType<typeof Bun.spawn> | undefined;
		let logs: Promise<string[]> | undefined;
		try {
			const seed = `const {sql,migrate}=await import(${JSON.stringify(join(root, "src/db.ts"))});
			await migrate(); const {createUser}=await import(${JSON.stringify(join(root, "src/auth.ts"))});
			for(const name of ${JSON.stringify(names)}) await createUser(name,name,${JSON.stringify(password)});
			const owner=await createUser('backend_owner','Owner',${JSON.stringify(password)});
			await sql\`update users set role = 'admin', created_at = \${new Date(0)} where id = \${sql.cast(owner,'bigint')}\`;
			await sql\`update users set verified_type = 'business' where screen_name = \${${JSON.stringify(names[2])}}\`; await sql.close();`;
			await run(["-e", seed], env);
			server = Bun.spawn([process.execPath, join(root, "src/server.ts")], { cwd: directory, env, stdout: "pipe", stderr: "pipe" });
			logs = Promise.all([new Response(server.stdout as ReadableStream).text(), new Response(server.stderr as ReadableStream).text()]);
			let ready = false;
			for (let attempt = 0; attempt < 200; attempt++) {
				if (server.exitCode !== null) throw new Error("Test server exited during startup");
				try {
					await fetch(`${env.PUBLIC_ORIGIN}/login`, { redirect: "manual" });
					ready = true;
					break;
				} catch {}
				await Bun.sleep(25);
			}
			if (!ready) throw new Error("Test server did not start");
			for (const [suite, args] of suites) {
				await run([join(root, `scripts/test-${suite}.ts`), ...args], env);
				console.log(`pass ${backend}: ${suite}`);
			}
		} catch (error) {
			server?.kill();
			if (logs) console.error((await logs).join("\n"));
			throw error;
		} finally {
			server?.kill();
			if (server) await server.exited;
			if (admin) {
				await admin.unsafe(`drop database "${databaseName}" with (force)`);
				await admin.close();
			}
		}
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
