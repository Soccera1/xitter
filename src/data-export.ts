// Settings > Your account > Download an archive of your data. The archive is
// made on the spot (JSON) and kept in the database for the person to fetch.
import type { Fragment } from "./db/query";
import { sql } from "./db";
import { newId } from "./ids";
import type { Viewer } from "./auth";
import * as thrift from "./thrift";
import { exportHtml } from "./export-html";

const json = (body: unknown, status = 200) => Response.json(body, { status });

// JS's Date.toJSON form, which the archive has always used
const iso = (column: Fragment) => sql.iso(column);
const jsonFields = new Set(["request", "choices", "choice_media", "sensitive_warning", "participant_ids", "metadata"]);
const booleanFields = new Set(["protected", "detached", "accepted", "archived", "muted"]);
const object = (fields: string[]) =>
	sql.jsonObject(
		...fields.flatMap((name) => {
			const value = sql`x.${sql(name)}`;
			return [name, jsonFields.has(name) ? sql.jsonValue(value) : booleanFields.has(name) ? sql.cast(value, "boolean") : value];
		}),
	);
const list = (query: Fragment, fields: string[]) => sql.jsonAgg(object(fields));
const rows = (query: Fragment, fields: string[]) => sql.jsonValue(sql`(select ${list(query, fields)} from (${query}) x)`);

// Match the message-history endpoints, including audience-specific and local
// deletions. Use this predicate again at final assembly after staging details.
const visibleChat = (userId: string) => sql`m.user_id = ${sql.cast(userId, "bigint")}
	and not e.deleted and (e.audience_id is null or e.audience_id = ${sql.cast(userId, "bigint")})
	and e.seq > m.deleted_before and not exists (select 1 from chat_hidden_events h where h.user_id = ${sql.cast(userId, "bigint")} and h.seq = e.seq)
	and e.kind in (1, 4, 7, 8, 12, 13)`;

async function stageChat(tx: typeof sql, userId: string) {
	// Stored envelopes contain a signed conversation token and key-change
	// events can contain wrapped keys. Stage only recognized non-key details,
	// never complete envelopes or public/private key records.
	await tx`create temporary table data_export_chat_details (
		seq bigint primary key, conversation_id text not null, sender_id bigint not null,
		kind smallint not null, source_hash text not null, detail_base64 text not null
	)`;
	const [upper] = await tx`select ${tx.cast(tx`max(seq)`, "text")} as seq from chat_events`;
	if (!upper.seq) return;
	let after = "0";
	for (;;) {
		// Bound both row count and bytes. A single large event is processed alone;
		// otherwise at most 1 MiB of event blobs reaches JS in each batch.
		const rows = await tx`with candidates as (
			select e.seq, e.conversation_id, e.sender_id, e.kind, e.event from chat_events e
			join chat_members m on m.conversation_id = e.conversation_id
			where ${visibleChat(userId)} and e.seq > ${tx.cast(after, "bigint")} and e.seq <= ${tx.cast(upper.seq, "bigint")}
			order by e.seq limit 128
		), sized as (
			select *, sum(${tx.byteLength(tx`event`)}) over (order by seq) as bytes,
				row_number() over (order by seq) as n from candidates
		) select ${tx.cast(tx`seq`, "text")} as seq, conversation_id, ${tx.cast(tx`sender_id`, "text")} as sender_id, kind, event, ${tx.hash(tx`event`)} as source_hash
			from sized where bytes <= 1048576 or n = 1 order by seq`;
		if (!rows.length) break;
		const details: { seq: string; conversation_id: string; sender_id: string; kind: number; source_hash: string; detail_base64: string }[] = [];
		for (const row of rows) {
			try {
				const detail = thrift.fields(thrift.decode(new Uint8Array(row.event))[7]);
				const value = detail?.[row.kind];
				if (value?.t !== thrift.T.struct) continue;
				// Select just the recognized union member: a malformed envelope must
				// not smuggle a key-change sibling alongside a message detail.
				details.push({
					seq: row.seq,
					conversation_id: row.conversation_id,
					sender_id: row.sender_id,
					kind: row.kind,
					source_hash: row.source_hash,
					detail_base64: Buffer.from(thrift.encode({ [row.kind]: value })).toString("base64"),
				});
			} catch {
				// Invalid historical blobs cannot safely be exported as raw envelopes.
			}
		}
		if (details.length) await tx`insert into data_export_chat_details ${tx.insertMany(details)}`;
		after = rows[rows.length - 1].seq;
	}
}

// The database assembles and stores the archive without copying its full body
// through JS. Encrypted chat details are sanitized in bounded batches first.
async function build(tx: typeof sql, viewer: Viewer, exportId: string) {
	const id = viewer.id;
	await stageChat(tx, id);
	await tx`insert into data_exports (id, user_id, body) select ${tx.cast(exportId, "bigint")}, ${tx.cast(id, "bigint")}, ${tx.jsonObject(
		tx`'generated_at'`,
		tx.cast(new Date().toISOString(), "text"),
		tx`'account'`,
		sql.jsonValue(
			tx`( select ${object(["screen_name", "name", "bio", "location", "website", "email", "language", "protected", "created_at"])} from ( select screen_name , name , bio , location , website , email , language , protected , ${iso(sql`created_at`)} as created_at from users where id = ${tx.cast(id, "bigint")} ) x )`,
		),
		tx`'posts'`,
		rows(
			sql`select ${sql.cast(sql`id`, "text")} as id, text, ${iso(sql`created_at`)} as created_at, ${sql.cast(sql`reply_to_id`, "text")} as reply_to_id, ${sql.cast(sql`poll_id`, "text")} as poll_id from posts where user_id = ${sql.cast(id, "bigint")} order by id`,
			["id", "text", "created_at", "reply_to_id", "poll_id"],
		),
		tx`'drafts'`,
		rows(
			sql`select ${sql.cast(sql`id`, "text")} as id, request, ${iso(sql`created_at`)} as created_at from scheduled_posts where user_id = ${sql.cast(id, "bigint")} and kind = 'draft' order by id`,
			["id", "request", "created_at"],
		),
		tx`'scheduled_posts'`,
		rows(
			sql`select ${sql.cast(sql`id`, "text")} as id, request, ${iso(sql`execute_at`)} as execute_at, ${iso(sql`created_at`)} as created_at from scheduled_posts where user_id = ${sql.cast(id, "bigint")} and kind = 'scheduled' order by execute_at, id`,
			["id", "request", "execute_at", "created_at"],
		),
		tx`'polls'`,
		rows(
			sql`select ${sql.cast(sql`p.id`, "text")} as id, p.choices, p.duration_minutes,
			${iso(sql`p.ends_at`)} as ends_at, ${iso(sql`p.created_at`)} as created_at,
			case when p.choice_media is null then null else (select ${sql.arrayAgg(sql.cast(sql`m.id`, "text"), sql`choice.key`)}
				from ${sql.each(sql`p.choice_media`)} choice
				left join media m on m.id = cast(choice.value as bigint) and m.user_id = ${sql.cast(id, "bigint")}) end as choice_media
			from polls p where p.user_id = ${sql.cast(id, "bigint")} order by p.id`,
			["id", "choices", "duration_minutes", "ends_at", "created_at", "choice_media"],
		),
		tx`'poll_votes'`,
		rows(
			sql`select ${sql.cast(sql`poll_id`, "text")} as poll_id, choice, ${iso(sql`created_at`)} as created_at
			from poll_votes where user_id = ${sql.cast(id, "bigint")} order by created_at, poll_id`,
			["poll_id", "choice", "created_at"],
		),
		tx`'media'`,
		rows(
			sql`select ${sql.cast(sql`id`, "text")} as id, kind, mime, size, width, height, ${sql.cast(sql`post_id`, "text")} as post_id, position,
			duration_ms, alt_text, sensitive_warning, state, detached, ${iso(sql`created_at`)} as created_at
			from media where user_id = ${sql.cast(id, "bigint")} order by id`,
			[
				"id",
				"kind",
				"mime",
				"size",
				"width",
				"height",
				"post_id",
				"position",
				"duration_ms",
				"alt_text",
				"sensitive_warning",
				"state",
				"detached",
				"created_at",
			],
		),
		tx`'bookmark_folders'`,
		rows(
			sql`select ${sql.cast(sql`id`, "text")} as id, name, ${iso(sql`created_at`)} as created_at
			from bookmark_folders where user_id = ${sql.cast(id, "bigint")} order by created_at, id`,
			["id", "name", "created_at"],
		),
		tx`'bookmark_folder_posts'`,
		rows(
			sql`select ${sql.cast(sql`fp.folder_id`, "text")} as folder_id, ${sql.cast(sql`fp.post_id`, "text")} as post_id, ${iso(sql`fp.created_at`)} as created_at
			from bookmark_folder_posts fp join bookmark_folders f on f.id = fp.folder_id
			join bookmarks b on b.post_id = fp.post_id and b.user_id = ${sql.cast(id, "bigint")}
			where f.user_id = ${sql.cast(id, "bigint")} order by fp.folder_id, fp.created_at, fp.post_id`,
			["folder_id", "post_id", "created_at"],
		),
		tx`'chat'`,
		tx.jsonObject(
			tx`'format'`,
			tx`'xitter-chat-event-details'`,
			tx`'version'`,
			tx`1`,
			tx`'event_detail_encoding'`,
			tx`'thrift-binary-base64'`,
			tx`'message_content'`,
			tx`'end-to-end encrypted'`,
			tx`'includes_decryption_keys'`,
			false,
			tx`'conversations'`,
			rows(
				sql`select m.conversation_id as id, ${sql.cast(sql`c.creator_id`, "text")} as creator_id,
				(select coalesce(${sql.jsonAgg(sql.cast(sql`peer.user_id`, "text"), sql`peer.user_id`, false)}, ${sql.cast(sql`'[]'`, "jsonb")}) from chat_members peer where peer.conversation_id = m.conversation_id) as participant_ids,
				${iso(sql`m.joined_at`)} as joined_at, m.accepted, m.archived, m.muted, ${sql.cast(sql`m.deleted_before`, "text")} as deleted_before,
				case when c.id is null then null else ${sql.jsonObject(sql`'group_name'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql`c.metadata`, sql`'group_name'`))} = 'string' then ${sql.jsonGet(sql`c.metadata`, sql`'group_name'`)} else null end`), sql`'description'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql`c.metadata`, sql`'description'`))} = 'string' then ${sql.jsonGet(sql`c.metadata`, sql`'description'`)} else null end`), sql`'created_at_msec'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql`c.metadata`, sql`'created_at_msec'`))} = 'string' then ${sql.jsonGet(sql`c.metadata`, sql`'created_at_msec'`)} else null end`), sql`'updated_at_msec'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql`c.metadata`, sql`'updated_at_msec'`))} = 'string' then ${sql.jsonGet(sql`c.metadata`, sql`'updated_at_msec'`)} else null end`), sql`'message_ttl_msec'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql`c.metadata`, sql`'message_ttl_msec'`))} = 'string' then ${sql.jsonGet(sql`c.metadata`, sql`'message_ttl_msec'`)} else null end`), sql`'group_type'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "classification"), "group_type"))} = 'string' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "classification"), "group_type")} else null end`), sql`'admin_settings'`, sql.jsonObject(sql`'add_member'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "add_member"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "add_member")} else null end`), sql`'edit_group_info'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "edit_group_info"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "edit_group_info")} else null end`), sql`'send_message'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "send_message"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "send_message")} else null end`), sql`'start_call'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "start_call"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "start_call")} else null end`), sql`'edit_message_ttl'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "edit_message_ttl"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "edit_message_ttl")} else null end`), sql`'block_screen_capture'`, sql.jsonValue(sql`case when ${sql.jsonType(sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "block_screen_capture"))} = 'boolean' then ${sql.jsonGet(sql.jsonGet(sql`c.metadata`, "admin_settings"), "block_screen_capture")} else null end`)))} end as metadata
				from chat_members m left join chat_conversations c on c.id = m.conversation_id
				where m.user_id = ${sql.cast(id, "bigint")} order by m.conversation_id`,
				["id", "creator_id", "participant_ids", "joined_at", "accepted", "archived", "muted", "deleted_before", "metadata"],
			),
			tx`'events'`,
			rows(
				sql`select ${sql.cast(sql`e.seq`, "text")} as seq, e.conversation_id, ${sql.cast(sql`e.sender_id`, "text")} as sender_id, e.kind,
				${iso(sql`e.created_at`)} as created_at, staged.detail_base64 as event_detail_base64
				from data_export_chat_details staged join chat_events e on e.seq = staged.seq
					and e.conversation_id = staged.conversation_id and e.sender_id = staged.sender_id and e.kind = staged.kind
				join chat_members m on m.conversation_id = e.conversation_id
				where ${visibleChat(id)} and ${sql.hash(sql`e.event`)} = staged.source_hash order by e.seq`,
				["seq", "conversation_id", "sender_id", "kind", "created_at", "event_detail_base64"],
			),
		),
		tx`'likes'`,
		rows(
			sql`select ${sql.cast(sql`post_id`, "text")} as post_id, ${iso(sql`created_at`)} as created_at from likes where user_id = ${sql.cast(id, "bigint")} order by likes.created_at`,
			["post_id", "created_at"],
		),
		tx`'bookmarks'`,
		rows(
			sql`select ${sql.cast(sql`post_id`, "text")} as post_id, ${iso(sql`created_at`)} as created_at from bookmarks where user_id = ${sql.cast(id, "bigint")} order by bookmarks.created_at`,
			["post_id", "created_at"],
		),
		tx`'following'`,
		rows(
			sql`select u.screen_name, ${iso(sql`f.created_at`)} as created_at from follows f join users u on u.id = f.followee_id where f.follower_id = ${sql.cast(id, "bigint")}`,
			["screen_name", "created_at"],
		),
		tx`'followers'`,
		rows(
			sql`select u.screen_name, ${iso(sql`f.created_at`)} as created_at from follows f join users u on u.id = f.follower_id where f.followee_id = ${sql.cast(id, "bigint")}`,
			["screen_name", "created_at"],
		),
		tx`'blocked'`,
		rows(sql`select u.screen_name from blocks b join users u on u.id = b.blocked_id where b.blocker_id = ${sql.cast(id, "bigint")}`, ["screen_name"]),
		tx`'muted'`,
		rows(sql`select u.screen_name from mutes m join users u on u.id = m.muted_id where m.muter_id = ${sql.cast(id, "bigint")}`, ["screen_name"]),
	)}`;
	await tx`drop table data_export_chat_details`;
}

const entry = (r: any) => ({
	id: r.id,
	status: "COMPLETED",
	created_at: new Date(r.created_at).toISOString(),
	urls: [`/i/api/xitter/export/${r.id}`, `/i/api/xitter/export/${r.id}.html`],
});

export async function dataExportRoute(method: string, path: string, viewer: Viewer, req: Request): Promise<Response | undefined> {
	if (path === "/1.1/account/user_twitter_data") {
		if (method === "GET") {
			const rows =
				await sql`select ${sql.cast(sql`id`, "text")} as id, created_at from data_exports where user_id = ${sql.cast(viewer.id, "bigint")} order by created_at desc limit 5`;
			return json(rows.map(entry));
		}
		if (method === "POST") {
			await sql.begin(async (tx) => {
				// Lock before checking the daily limit so concurrent requests (including
				// requests handled by another server) cannot store duplicate full copies.
				await tx`select id from users where id = ${tx.cast(viewer.id, "bigint")} ${tx.lock(false)}`;
				await tx`delete from data_exports where user_id = ${tx.cast(viewer.id, "bigint")} and created_at < now() - ${tx.duration(7, "day")}`;
				const [recent] =
					await tx`select 1 from data_exports where user_id = ${tx.cast(viewer.id, "bigint")} and created_at > now() - ${tx.duration(1, "day")} limit 1`;
				if (!recent) await build(tx, viewer, newId());
			});
			return json({ status: "ok" });
		}
		if (method === "PUT") return json({ status: "ok" });
	}
	if (path === "/1.1/account/personalization/email_your_data" && method === "POST") return json({ status: "ok" });
	const m = /^\/xitter\/export\/(\d{1,19})(\.html)?$/.exec(path);
	if (m && method === "GET") {
		const [row] =
			await sql`select ${m[2] ? sql`body` : sql.cast(sql`body`, "text")} as body from data_exports where id = ${sql.cast(m[1], "bigint")} and user_id = ${sql.cast(viewer.id, "bigint")}`;
		if (!row) return json({ errors: [{ code: 34, message: "Sorry, that page does not exist." }] }, 404);
		const filename = viewer.screen_name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "account";
		return new Response(m[2] ? exportHtml(row.body as Record<string, unknown>) : row.body, {
			headers: {
				"content-type": m[2] ? "text/html; charset=utf-8" : "application/json",
				"content-disposition": `attachment; filename="${filename}-data.${m[2] ? "html" : "json"}"`,
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
			},
		});
	}
	return undefined;
}
