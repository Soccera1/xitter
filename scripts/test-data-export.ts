// Direct route integration checks using a migrated, disposable PostgreSQL database.
// DATABASE_URL=postgres://localhost/xitter_test bun scripts/test-data-export.ts
import { strict as assert } from "node:assert";
import { sql } from "../src/db";
import { newId } from "../src/ids";
import type { Viewer } from "../src/auth";
import { dataExportRoute } from "../src/data-export";
import { exportHtml } from "../src/export-html";
import * as thrift from "../src/thrift";

const database = new URL(process.env.DATABASE_URL ?? "postgres://localhost/xitter");
assert((database.protocol === "sqlite:" && database.pathname.startsWith("/tmp/") && /test/.test(database.pathname)) || (["localhost", "127.0.0.1"].includes(database.hostname) && /test|codex/.test(database.pathname)), "Use a disposable local test database.");

const owner = newId(), other = newId();
const chatId = `export_chat_${owner}`, chatSeq = newId();
const content = new Map<string, { post: string; poll: string; photo: string; attached: string; processing: string; folder: string }>();
const viewer = { id: owner, screen_name: `export_${owner}` } as Viewer;
const route = async (method: string, path = "/1.1/account/user_twitter_data", user = viewer) => {
 const response = await dataExportRoute(method, path, user, new Request("http://localhost/"));
 assert(response); return response;
};
try {
 for (const id of [owner, other]) await sql`insert into users (id, screen_name, name, password_hash) values (${sql.cast(id, "bigint")}, ${`export_${id}`}, 'Export Test', 'not-a-secret')`;
 for (const id of [owner, other]) {
  await sql`insert into scheduled_posts (id, user_id, kind, request) values (${sql.cast(newId(), "bigint")}, ${sql.cast(id, "bigint")}, 'draft', ${sql.cast(sql.cast(JSON.stringify({ status: `private draft ${id}` }), "text"), "jsonb")})`;
  await sql`insert into scheduled_posts (id, user_id, kind, execute_at, request) values (${sql.cast(newId(), "bigint")}, ${sql.cast(id, "bigint")}, 'scheduled', now() + ${sql.duration(1, "hour")}, ${sql.cast(sql.cast(JSON.stringify({ status: `future post ${id}` }), "text"), "jsonb")})`;
 }
 // A poll-only post has no text: its choices and media are the authored content.
 for (const id of [owner, other]) {
  const post = newId(), poll = newId(), photo = newId(), attached = newId(), processing = newId(), folder = newId();
  content.set(id, { post, poll, photo, attached, processing, folder });
  const label = id === owner ? "Tea" : "FOREIGN_POLL_SECRET";
  await sql`insert into polls (id, user_id, choices, duration_minutes, ends_at, choice_media)
   values (${sql.cast(poll, "bigint")}, ${sql.cast(id, "bigint")}, ${sql.array([label, "Coffee"], "TEXT")}, 5, now() + ${sql.duration(5, "minute")}, ${sql.array([photo, "0"], "INT8")})`;
  await sql`insert into posts (id, user_id, text, conversation_id, poll_id) values (${sql.cast(post, "bigint")}, ${sql.cast(id, "bigint")}, '', ${sql.cast(post, "bigint")}, ${sql.cast(poll, "bigint")})`;
  for (const mediaId of [photo, attached, processing]) await sql`insert into media
   (id, user_id, kind, mime, size, width, height, post_id, alt_text, sensitive_warning, state, remote_instance)
   values (${sql.cast(mediaId, "bigint")}, ${sql.cast(id, "bigint")}, ${mediaId === processing ? "video" : "photo"}, ${mediaId === processing ? "video/mp4" : "image/png"}, 4, 1, 1,
    ${sql.cast(mediaId === attached ? post : null, "bigint")}, ${id === owner ? "Own photo description" : "FOREIGN_MEDIA_SECRET"}, ${sql.array(['other'], "TEXT")}, ${mediaId === processing ? "processing" : "ready"}, 'PRIVATE_PROVIDER_SECRET')`;
  await sql`insert into bookmarks (user_id, post_id) values (${sql.cast(id, "bigint")}, ${sql.cast(post, "bigint")})`;
  await sql`insert into bookmark_folders (id, user_id, name) values (${sql.cast(folder, "bigint")}, ${sql.cast(id, "bigint")}, ${id === owner ? "Research" : "FOREIGN_FOLDER_SECRET"})`;
  await sql`insert into bookmark_folder_posts (folder_id, post_id) values (${sql.cast(folder, "bigint")}, ${sql.cast(post, "bigint")})`;
 }
 const mine = content.get(owner)!, theirs = content.get(other)!;
 // The poll owner's archive may include their choice, never other voters' choices.
 await sql`insert into poll_votes (poll_id, user_id, choice) values (${sql.cast(mine.poll, "bigint")}, ${sql.cast(owner, "bigint")}, 1), (${sql.cast(mine.poll, "bigint")}, ${sql.cast(other, "bigint")}, 2)`;
 // Defense in depth for stale/corrupt references: a foreign media id is not
 // exported merely because it appears in the owner's authored poll metadata.
 const stalePoll = newId();
 await sql`insert into polls (id, user_id, choices, duration_minutes, choice_media) values
  (${sql.cast(stalePoll, "bigint")}, ${sql.cast(owner, "bigint")}, ${sql.array(['Legacy', 'Other'], "TEXT")}, 5, ${sql.array([theirs.photo, "0"], "INT8")})`;
 // A stale folder relation without the owner's bookmark is absent from the UI.
 await sql`insert into bookmark_folder_posts (folder_id, post_id) values (${sql.cast(mine.folder, "bigint")}, ${sql.cast(theirs.post, "bigint")})`;
 await sql`insert into chat_conversations(id,creator_id,created,metadata) values (${chatId},${sql.cast(owner,"bigint")},true,${sql.cast(JSON.stringify({group_name:"Encrypted title",classification:{group_type:"Normal"},admin_settings:{send_message:false,start_call:{secret:"PRIVATE_CHAT_SETTING"}}}),"jsonb")})`;
 await sql`insert into chat_members(conversation_id,user_id,accepted,archived,muted) values (${chatId},${sql.cast(owner,"bigint")},false,true,true)`;
 const envelope = Buffer.from(thrift.encode({5:thrift.str("PRIVATE_ENVELOPE_TOKEN"),7:thrift.struct({1:thrift.struct({100:thrift.str("ENCRYPTED_CONTENT")}),3:thrift.struct({1:thrift.str("PRIVATE_WRAPPED_KEY")})})}));
 await sql`insert into chat_events(seq,conversation_id,sender_id,kind,event) values (${sql.cast(chatSeq,"bigint")},${chatId},${sql.cast(owner,"bigint")},1,${envelope})`;
 await Promise.all(Array.from({ length: 12 }, () => route("POST")));
 const exports = await (await route("GET")).json();
 assert.equal(exports[0].urls.length, 2, "JSON and readable HTML downloads are offered");
 const [count] = await sql`select ${sql.cast(sql` count(*)`, "int")} as n from data_exports where user_id = ${sql.cast(owner, "bigint")}`;
 assert.equal(count.n, 1, "concurrent requests create only one daily archive");
 const response = await route("GET", `/xitter/export/${exports[0].id}`);
 assert.equal(response.headers.get("cache-control"), "no-store");
 const archive = await response.json();
 const group = archive.chat.conversations.find((c:any)=>c.id===chatId);
 assert.equal(group.accepted,false); assert.equal(group.archived,true); assert.equal(group.muted,true);
 assert.equal(group.metadata.group_name,"Encrypted title"); assert.equal(group.metadata.admin_settings.send_message,false); assert.equal(group.metadata.admin_settings.start_call,null);
 assert.equal(archive.chat.includes_decryption_keys,false);
 const event = archive.chat.events.find((e:any)=>e.seq===chatSeq);
 const raw = Buffer.from(event.event_detail_base64,"base64");
 const detail = thrift.decode(raw); assert.deepEqual(Object.keys(detail),["1"]);
 assert.equal(thrift.text(thrift.fields(detail[1])?.[100]),"ENCRYPTED_CONTENT");
 for(const secret of ["PRIVATE_ENVELOPE_TOKEN","PRIVATE_WRAPPED_KEY","PRIVATE_CHAT_SETTING"]) assert(!(JSON.stringify(archive)+raw.toString("latin1")).includes(secret));
 const readable = await route("GET", `/xitter/export/${exports[0].id}.html`);
 assert.equal(readable.headers.get("content-type"), "text/html; charset=utf-8");
 assert.equal(readable.headers.get("cache-control"), "no-store");
 const page = await readable.text();
 assert(page.includes("Your Xitter archive") && page.includes("Tea"), "offline page shows archived content");
 const injection = exportHtml({ account: { screen_name: '<img src=x onerror=alert(1)>' }, posts: [{ text: '<script>alert(1)</script>' }] });
 assert(!injection.includes("<script>") && !injection.includes("<img"), "offline viewer escapes archived text");
 assert(injection.includes("&lt;script&gt;"), "escaped text remains readable");
 assert.equal((await route("GET", `/xitter/export/${exports[0].id}.html`, { ...viewer, id: other })).status, 404);
 assert(Array.isArray(archive.posts) && Array.isArray(archive.followers), "existing archive keys remain");
 assert.equal(archive.drafts.length, 1, "includes only own draft");
 assert.equal(archive.scheduled_posts.length, 1, "includes only own scheduled post");
 assert.equal(archive.drafts[0].request.status, `private draft ${owner}`);
 assert.equal(archive.scheduled_posts[0].request.status, `future post ${owner}`);
 assert.match(archive.scheduled_posts[0].execute_at, /Z$/);
 assert(!JSON.stringify(archive).includes(other), "other account private drafts stay private");
 assert(!JSON.stringify(archive).includes("not-a-secret"), "password hashes are never exported");
 assert.equal(archive.posts.length, 1);
 assert.equal(archive.posts[0].text, ""); assert.equal(archive.posts[0].poll_id, mine.poll);
 const poll = archive.polls.find((p: any) => p.id === mine.poll);
 assert.deepEqual(poll.choices, ["Tea", "Coffee"]); assert.equal(poll.duration_minutes, 5);
 assert.match(poll.ends_at, /Z$/); assert.deepEqual(poll.choice_media, [mine.photo, null]);
 assert.deepEqual(archive.polls.find((p: any) => p.id === stalePoll).choice_media, [null, null]);
 assert.equal(archive.poll_votes.length, 1); assert.equal(archive.poll_votes[0].choice, 1);
 assert(!("user_id" in archive.poll_votes[0]), "no voter identities are included");
 assert.equal(archive.media.length, 3);
 const photo = archive.media.find((m: any) => m.id === mine.photo);
 assert.equal(photo.alt_text, "Own photo description"); assert.deepEqual(photo.sensitive_warning, ["other"]);
 assert.equal(photo.mime, "image/png"); assert.equal(photo.size, 4); assert.equal(photo.state, "ready");
 assert.equal(archive.media.find((m: any) => m.id === mine.attached).post_id, mine.post);
 assert.equal(archive.media.find((m: any) => m.id === mine.processing).state, "processing");
 assert.equal(archive.bookmark_folders.length, 1); assert.equal(archive.bookmark_folders[0].name, "Research");
 assert.equal(archive.bookmark_folder_posts.length, 1); assert.equal(archive.bookmark_folder_posts[0].folder_id, mine.folder);
 assert.equal(archive.bookmark_folder_posts[0].post_id, mine.post);
 for (const marker of ["FOREIGN_POLL_SECRET", "FOREIGN_MEDIA_SECRET", "FOREIGN_FOLDER_SECRET", "PRIVATE_PROVIDER_SECRET", theirs.post, theirs.photo])
  assert(!JSON.stringify(archive).includes(marker), `foreign content/provider secrets excluded: ${marker}`);
 assert.equal((await route("GET", `/xitter/export/${exports[0].id}`, { ...viewer, id: other })).status, 404);
 await route("POST");
 assert.equal((await (await route("GET")).json()).length, 1, "repeated requests reuse archive");
 await sql`update data_exports set created_at = now() - ${sql.duration(8, "day")} where user_id = ${sql.cast(owner, "bigint")}`;
 await route("POST");
 const fresh = await (await route("GET")).json();
 assert.equal(fresh.length, 1, "expired archive removed");
 assert.notEqual(fresh[0].id, exports[0].id, "new archive created after expiry");
 console.log("data export concurrency, completeness, isolation and retention checks passed");
} finally {
 await sql`delete from chat_conversations where id=${chatId}`;
 await sql`delete from users where id in (${sql.cast(owner, "bigint")}, ${sql.cast(other, "bigint")})`;
 await sql.close();
}
