// Real PostgreSQL mention preflight: unknown fullhandles resolve before queue/publication locks.
import assert from "node:assert/strict";
import type { Viewer } from "../src/auth";
import { sql } from "../src/db";
import { newId } from "../src/ids";
import { runDue, scheduledHandlers as h } from "../src/scheduled";
const database=new URL(process.env.DATABASE_URL??"postgres://localhost/xitter");
assert(["localhost","127.0.0.1"].includes(database.hostname)&&/test|codex/.test(database.pathname),"Use a disposable local test database.");
const author=newId(),known=newId(),learned=newId(),v={id:author} as Viewer;
const knownHandle=`k${known.slice(-10)}@peer.invalid`, learnedHandle=`l${learned.slice(-10)}@peer.invalid`;
const created=[author,known];
const nativeFetch=globalThis.fetch;
let networkCalls=0;
globalThis.fetch=(async()=>{networkCalls++;throw new Error("No external network is permitted in this regression");}) as typeof fetch;
try {
 await sql`insert into users(id,screen_name,name,password_hash) values (${sql.cast(author, "bigint")},${`ma${author.slice(-10)}`},'Mention author','!')`;
 await sql`insert into users(id,screen_name,name,password_hash,instance) values (${sql.cast(known, "bigint")},${knownHandle},'Known remote','!','peer.invalid')`;
 const at=Math.floor(Date.now()/1000)+3600;
 const first=(await h.CreateScheduledTweet(v,{execute_at:at,post_tweet_request:{status:`mentions root @${knownHandle} @${learnedHandle} @missing@peer.invalid`,thread_tweets:[{status:`mentions reply @${knownHandle} @${learnedHandle}`}]}})).data.tweet.rest_id;
 const second=(await h.CreateScheduledTweet(v,{execute_at:at,post_tweet_request:{status:Array.from({length:20},(_,i)=>`@u${i}@unknown.invalid`).join(" "),thread_tweets:[{status:Array.from({length:10},(_,i)=>`@u${i+20}@unknown.invalid`).join(" ")}]}})).data.tweet.rest_id;
 await sql`update scheduled_posts set execute_at=now()-${sql.duration(1, "second")} where id in (${sql.cast(first, "bigint")},${sql.cast(second, "bigint")})`;
 const lookups:string[]=[];
 let probeClaimed=false,probePassed=false,learnedInserted=false;
 const count=await runDue(async(handle)=>{
  lookups.push(handle);
  // Claim this probe synchronously: concurrent NOWAIT probes would contend
  // with each other even though publication has not locked anything yet.
  if(!probeClaimed){
   probeClaimed=true;
   await sql.begin(async(tx)=>{await tx`select id from scheduled_posts where user_id=${tx.cast(author, "bigint")} ${tx.lock(false)} nowait`;});
   assert.equal((await sql`select ${sql.cast(sql` count(*)`, "int")} n from posts where user_id=${sql.cast(author, "bigint")}`)[0].n,0,"preflight completes before any publication");
   probePassed=true;
  }
  if(handle===learnedHandle){await sql`insert into users(id,screen_name,name,password_hash,instance) values (${sql.cast(learned, "bigint")},${learnedHandle},'Resolved remote','!','peer.invalid')`;created.push(learned);learnedInserted=true;return learned;}
  throw new Error("unreachable remote fixture");
 });
 // Production deliberately swallows failed best-effort lookups, so check the
 // fixture's successes explicitly instead of losing assertions in that catch.
 assert(probePassed,"the preflight queue-lock probe must complete successfully");
 assert(learnedInserted,"the learned-handle fixture must be inserted before publication");
 assert.equal(count,2);assert.equal(lookups.length,20,"unknown remote work is bounded once per batch");assert.equal(new Set(lookups).size,20);
 assert(!lookups.includes(knownHandle),"known fullhandles need no network lookup");assert(lookups.includes(learnedHandle));
 const rows=await sql`select ${sql.cast(sql` p.id`, "text")} as id,p.text,${sql.cast(sql`count(m.user_id)`, "int")} mentions from posts p left join post_mentions m on m.post_id=p.id where p.user_id=${sql.cast(author, "bigint")} group by p.id order by p.id`;
 assert.equal(rows.length,4);assert.equal(rows[0].mentions,2);assert.equal(rows[1].mentions,2);
 assert.equal((await sql`select ${sql.cast(sql` count(*)`, "int")} n from post_mentions where user_id=${sql.cast(learned, "bigint")}`)[0].n,2);
 assert.equal((await sql`select ${sql.cast(sql` count(*)`, "int")} n from scheduled_posts where user_id=${sql.cast(author, "bigint")}`)[0].n,0);
 assert.equal(networkCalls,0);
 console.log("Scheduled mentions passed:20 bounded deduplicated preflight lookups with queue rows freely lockable, known/new fullhandles saved on both posts, failed remote lookups still publish complete threads, no external network");
} finally {
 globalThis.fetch=nativeFetch;
 for(const id of created)await sql`delete from users where id=${sql.cast(id, "bigint")}`;
 await sql.close();
}
