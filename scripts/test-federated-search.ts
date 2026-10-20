// Actual application HTTP + PostgreSQL: federated account search operators and privacy.
// The client/helper forwards search text unchanged as SearchTimeline.rawQuery.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const database=new URL(process.env.DATABASE_URL??"postgres://localhost/xitter");
assert(["localhost","127.0.0.1"].includes(database.hostname)&&/test|codex/.test(database.pathname),"Use a disposable local test database.");
const dir=await mkdtemp(join(tmpdir(),"xitter-federated-search-"));
const probe=Bun.serve({port:0,fetch:()=>new Response()});const port=probe.port;probe.stop(true);
const origin=`http://localhost:${port}`;process.env.PUBLIC_ORIGIN=origin;process.env.MEDIA_DIR=dir;
const {sql,migrate}=await import("../src/db");await migrate();
const {newId}=await import("../src/ids");const {startSession}=await import("../src/auth");
const viewer=newId(),local=newId(),remote=newId(),second=newId(),users=[viewer,local,remote,second];
const name=`a${local.slice(-10)}`,remoteHandle=`${name}@peer.invalid:8443`,secondHandle=`${name}@second.invalid`,ownAlias=`${name}@localhost:${port}`;
const needle=`q${viewer}`;
const posts=Array.from({length:9},()=>newId());const [localPost,remotePost,secondPost,toRemote,toLocal,mentionRemote,mentionLocal,mentionSecond,unrelated]=posts;
// Keep registry validation deterministic; these fixture peers are active and never contacted.
const [previousRegistry] = await sql`select value from federation_state where key = 'registry'`;
const fixtureRegistry = {version: 1, sequence: Date.now(), instances: ["peer.invalid:8443", "second.invalid"].map(id => ({id, name: id, source_url: null, public_key: null, state: "active"}))};
await sql`insert into federation_state(key,value) values ('registry', ${sql.cast(JSON.stringify(fixtureRegistry), "jsonb")}) on conflict(key) do update set value = excluded.value`;
const server=Bun.spawn([process.execPath,"src/server.ts"],{cwd:join(import.meta.dir,".."),env:{...process.env,DATABASE_URL:database.href,PORT:String(port),PUBLIC_ORIGIN:origin,MEDIA_DIR:dir,RATE_LIMITS:"off",FEDERATION:"off"},stdout:"ignore",stderr:"pipe"});
const diagnostics=new Response(server.stderr).text();
let succeeded=false;
try {
 await sql`insert into users(id,screen_name,name,password_hash,instance) values
  (${sql.cast(viewer, "bigint")},${`v${viewer.slice(-10)}`},'Search viewer','!',null),
  (${sql.cast(local, "bigint")},${name},'Local collision','!',null),
  (${sql.cast(remote, "bigint")},${remoteHandle},'Remote collision','!','peer.invalid:8443'),
  (${sql.cast(second, "bigint")},${secondHandle},'Other remote collision','!','second.invalid')`;
 const session=await startSession(viewer);const headers={cookie:`auth_token=${session.token}; ct0=${session.csrf}`,"x-csrf-token":session.csrf};
 const ready=Date.now()+15000;
 while(true){try{if((await fetch(`${origin}/account/forgot`)).status===200)break;}catch{}assert(Date.now()<ready,"Application server failed to start");await Bun.sleep(30);}
 await sql`insert into posts(id,user_id,text,conversation_id,reply_to_id) values
  (${sql.cast(localPost, "bigint")},${sql.cast(local, "bigint")},${`${needle} local #café`},${sql.cast(localPost, "bigint")},null),
  (${sql.cast(remotePost, "bigint")},${sql.cast(remote, "bigint")},${`${needle} remote #café`},${sql.cast(remotePost, "bigint")},null),
  (${sql.cast(secondPost, "bigint")},${sql.cast(second, "bigint")},${`${needle} second #caféine`},${sql.cast(secondPost, "bigint")},null),
  (${sql.cast(toRemote, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} remote reply`},${sql.cast(remotePost, "bigint")},${sql.cast(remotePost, "bigint")}),
  (${sql.cast(toLocal, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} local reply`},${sql.cast(localPost, "bigint")},${sql.cast(localPost, "bigint")}),
  (${sql.cast(mentionRemote, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} @${remoteHandle}`},${sql.cast(mentionRemote, "bigint")},null),
  (${sql.cast(mentionLocal, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} @${name}`},${sql.cast(mentionLocal, "bigint")},null),
  (${sql.cast(mentionSecond, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} @${secondHandle}`},${sql.cast(mentionSecond, "bigint")},null),
  (${sql.cast(unrelated, "bigint")},${sql.cast(viewer, "bigint")},${`${needle} unrelated`},${sql.cast(unrelated, "bigint")},null)`;
 await sql`insert into post_mentions(post_id,user_id) values (${sql.cast(mentionRemote, "bigint")},${sql.cast(remote, "bigint")}),(${sql.cast(mentionLocal, "bigint")},${sql.cast(local, "bigint")}),(${sql.cast(mentionSecond, "bigint")},${sql.cast(second, "bigint")})`;
 let checks=0;
 async function search(query:string){
  const variables={rawQuery:query,product:"Latest",count:50,querySource:"typed_query"};
  const res=await fetch(`${origin}/i/api/graphql/q/SearchTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}`,{headers});assert.equal(res.status,200);
  const out=await res.json();assert(!out.errors,JSON.stringify(out.errors));
  return out.data.search_by_raw_query.search_timeline.timeline.instructions.flatMap((instruction:any)=>instruction.entries??[]).filter((entry:any)=>entry.entryId.startsWith("tweet-")).map((entry:any)=>entry.content.itemContent.tweet_results.result.rest_id).sort();
 }
 const matches=async(query:string,expected:string[])=>{assert.deepEqual(await search(query),[...expected].sort(),query);checks++;};
 await matches(`from:${remoteHandle}`,[remotePost]);
 await matches(`${needle} from:${remoteHandle}`,[remotePost]);
 await matches(`${needle} FrOm:@${remoteHandle.toUpperCase()}`,[remotePost]);
 await matches(`${needle} from:${secondHandle}`,[secondPost]);
 await matches(`${needle} from:${name}`,[localPost]);
 await matches(`${needle} from:@${name}`,[localPost]);
 await matches(`${needle} from:${ownAlias.toUpperCase()}`,[localPost]);
 await matches(`${needle} from:${name}@localhost:${port+1}`,[]);
 await matches(`${needle} to:${remoteHandle}`,[toRemote]);
 await matches(`${needle} to:@${remoteHandle.toUpperCase()}`,[toRemote]);
 await matches(`${needle} to:${name}`,[toLocal]);
 await matches(`${needle} to:${ownAlias}`,[toLocal]);
 await matches(`${needle} @${remoteHandle}`,[mentionRemote]);
 await matches(`${needle} @${secondHandle}`,[mentionSecond]);
 await matches(`${needle} @${name}`,[mentionLocal]);
 await matches(`${needle} @${ownAlias}`,[mentionLocal]);
 await matches(`${needle} -from:${remoteHandle}`,posts.filter(id=>id!==remotePost));
 await matches(`${needle} -to:${remoteHandle}`,posts.filter(id=>id!==toRemote));
 await matches(`${needle} -@${remoteHandle}`,posts.filter(id=>id!==mentionRemote));
 await matches(`${needle} -from:${ownAlias}`,posts.filter(id=>id!==localPost));
 await matches(`${needle} -to:${ownAlias}`,posts.filter(id=>id!==toLocal));
 await matches(`${needle} -@${ownAlias}`,posts.filter(id=>id!==mentionLocal));
 for(const operator of [`from:nobody@missing.invalid`,`to:nobody@missing.invalid`,`@nobody@missing.invalid`]){
  await matches(`${needle} ${operator}`,[]);await matches(`${needle} -${operator}`,posts);
 }
 await matches(`${needle} #café`,[localPost,remotePost]);
 await matches(`${needle} from:${remoteHandle} #café`,[remotePost]);
 console.log("ok: fullhandle author/recipient/mention filters, same-name local/remote isolation, host:port, own-instance aliases, negation and unchanged Unicode hashtags");
 await sql`update users set protected=true where id=${sql.cast(remote, "bigint")}`;await matches(`${needle} from:${remoteHandle}`,[]);
 await sql`insert into follows(follower_id,followee_id) values (${sql.cast(viewer, "bigint")},${sql.cast(remote, "bigint")})`;await matches(`${needle} from:${remoteHandle}`,[remotePost]);
 await sql`delete from follows where follower_id=${sql.cast(viewer, "bigint")} and followee_id=${sql.cast(remote, "bigint")}`;await sql`update users set protected=false where id=${sql.cast(remote, "bigint")}`;
 for(const [blocker,blocked]of [[viewer,remote],[remote,viewer]]){
  await sql`insert into blocks(blocker_id,blocked_id) values (${sql.cast(blocker, "bigint")},${sql.cast(blocked, "bigint")})`;await matches(`${needle} from:${remoteHandle}`,[]);await matches(`${needle} -from:${secondHandle}`,posts.filter(id=>![remotePost,secondPost].includes(id)));
  await sql`delete from blocks where blocker_id=${sql.cast(blocker, "bigint")} and blocked_id=${sql.cast(blocked, "bigint")}`;
 }
 await sql`update users set status='suspended' where id=${sql.cast(remote, "bigint")}`;await matches(`${needle} from:${remoteHandle}`,[]);await sql`update users set status='active',instance_blocked=true where id=${sql.cast(remote, "bigint")}`;await matches(`${needle} from:${remoteHandle}`,[]);
 await sql`update users set instance_blocked=false where id=${sql.cast(remote, "bigint")}`;await sql`update posts set hidden=true where id=${sql.cast(remotePost, "bigint")}`;await matches(`${needle} from:${remoteHandle}`,[]);
 succeeded=true;console.log(`Federated search HTTP regression passed: ${checks} checks including protection/follow approval, both block directions, suspension, blocked instance and hidden posts`);
} finally {
 server.kill();await server.exited;const logs=await diagnostics;if(!succeeded)console.error(logs);
 for(const id of users)await sql`delete from users where id=${sql.cast(id, "bigint")}`;
 if (previousRegistry) await sql`update federation_state set value = ${sql.cast(JSON.stringify(previousRegistry.value), "jsonb")} where key = 'registry'`;
 else await sql`delete from federation_state where key = 'registry'`;
 await sql.close();await rm(dir,{recursive:true,force:true});
}
