import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { newId } from "./ids";
import { settings } from "./settings";

// the web client's own name; stored with each post, renamed with the instance (admin.ts)
export const webSource = (name = settings().instance_name) => `${name} for Web`;

// a client's stored source and sign-up app move to the instance's new name
export async function renameWebSource(from: string, to: string) {
	if (from === to) return;
	const [a, b] = [webSource(from), webSource(to)];
	await sql`update posts set source = ${b} where source = ${a}`;
	await sql`update users set signup_source = ${b} where signup_source = ${a}`;
	await sql`update login_events set app = ${b} where app = ${a}`;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createPlatform(label: string, actorId: string) {
	const token = `xitter_${randomBytes(32).toString("hex")}`;
	const id = newId();
	await sql`insert into client_platforms (id, label, token_hash, creator_id) values (${sql.cast(id, "bigint")}, ${label}, ${hash(token)}, ${sql.cast(actorId, "bigint")})`;
	return { id, label, token };
}

export async function platformSource(req: Request): Promise<string | null> {
	const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
	if (!token?.startsWith("xitter_")) return webSource();
	const [platform] = await sql`select label from client_platforms where token_hash = ${hash(token)} and not revoked`;
	return platform?.label ?? null;
}
