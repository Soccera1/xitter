// Bookmark folders: named groups of the viewer's bookmarks. Adding a post to a
// folder bookmarks it too; removing the bookmark leaves it in the folder's
// list only while it stays bookmarked.
import type { Viewer } from "./auth";
import { sql } from "./db";
import { isId, newId } from "./ids";
import { cursorEntry, tweetEntry } from "./model";
import { PUBLIC_ORIGIN } from "./config";
import { mediaUrl, posterUrl } from "./media";
import { PostError, folderPosts, originalPostId, setMark } from "./posts";

type Vars = Record<string, any>;
const MAX_FOLDERS = 25;

const folderId = (vars: Vars) => {
	const id = String(vars.bookmark_collection_id ?? "");
	if (!isId(id)) throw new PostError("That folder doesn't exist.", 144);
	return id;
};

// the client lists a folder only when it has a cover picture: the newest photo
// in it, else the instance logo
const cover = (url?: string) => ({
	media_info: { __typename: "ApiImage", original_img_url: url ?? `${PUBLIC_ORIGIN}/icon-dark.png`, original_img_width: 400, original_img_height: 400 },
});
const item = (r: { id: string; name: string; cover?: string }) => ({ __typename: "BookmarkCollection", id: r.id, name: r.name, media: cover(r.cover) });

async function mine(viewerId: string, id: string) {
	const [r] = await sql`select ${sql.cast(sql`id`, "text")} as id, name from bookmark_folders where id = ${sql.cast(id, "bigint")} and user_id = ${sql.cast(viewerId, "bigint")}`;
	if (!r) throw new PostError("That folder doesn't exist.", 144);
	return r as { id: string; name: string };
}

const cleanName = (v: unknown) => {
	const name = typeof v === "string" ? v.trim().slice(0, 25) : "";
	if (!name) throw new PostError("A folder needs a name.", 187);
	return name;
};

const coverUrl = (packed: string | null) => {
	if (!packed) return undefined;
	const [id, kind, mime] = packed.split(":");
	return kind === "video" ? posterUrl(id) : mediaUrl(id, mime);
};

export const bookmarkFolderHandlers = {
	BookmarkFoldersSlice: async (v: Viewer) => {
		const rows = await sql`select ${sql.cast(sql`f.id`, "text")} as id, f.name,
				(select ${sql.cast(sql`m.id`, "text")} || ':' || m.kind || ':' || m.mime from bookmark_folder_posts fp join media m on m.post_id = fp.post_id
					where fp.folder_id = f.id order by fp.created_at desc, m.position limit 1) as cover
			from bookmark_folders f where f.user_id = ${sql.cast(v.id, "bigint")} order by f.created_at`;
		return { data: { viewer: { user_results: { result: { __typename: "User", bookmark_collections_slice: { items: rows.map((r: any) => item({ ...r, cover: coverUrl(r.cover) })), slice_info: { has_next_page: false } } } } } } };
	},
	createBookmarkFolder: async (v: Viewer, vars: Vars) => {
		const name = cleanName(vars.name);
		const [n] = await sql`select ${sql.cast(sql`count(*)`, "int")} as n from bookmark_folders where user_id = ${sql.cast(v.id, "bigint")}`;
		if (n.n >= MAX_FOLDERS) throw new PostError("You have too many folders.", 214);
		const id = newId();
		await sql`insert into bookmark_folders (id, user_id, name) values (${sql.cast(id, "bigint")}, ${sql.cast(v.id, "bigint")}, ${name})`;
		return { data: { bookmark_collection_create: item({ id, name }) } };
	},
	EditBookmarkFolder: async (v: Viewer, vars: Vars) => {
		const f = await mine(v.id, folderId(vars));
		const name = cleanName(vars.name);
		await sql`update bookmark_folders set name = ${name} where id = ${sql.cast(f.id, "bigint")}`;
		return { data: { bookmark_collection_update: item({ id: f.id, name }) } };
	},
	DeleteBookmarkFolder: async (v: Viewer, vars: Vars) => {
		const f = await mine(v.id, folderId(vars));
		await sql`delete from bookmark_folders where id = ${sql.cast(f.id, "bigint")}`;
		return { data: { bookmark_collection_delete: "Done" } };
	},
	bookmarkTweetToFolder: async (v: Viewer, vars: Vars) => {
		const f = await mine(v.id, folderId(vars));
		const raw = String(vars.tweet_id ?? "");
		if (!isId(raw)) throw new PostError("Invalid post id.", 144);
		const post = await originalPostId(raw);
		await setMark("bookmarks", v.id, post, true);
		await sql`insert into bookmark_folder_posts (folder_id, post_id) values (${sql.cast(f.id, "bigint")}, ${sql.cast(post, "bigint")}) on conflict do nothing`;
		return { data: { bookmark_collection_tweet_put: "Done" } };
	},
	RemoveTweetFromBookmarkFolder: async (v: Viewer, vars: Vars) => {
		const f = await mine(v.id, folderId(vars));
		const raw = String(vars.tweet_id ?? "");
		if (!isId(raw)) throw new PostError("Invalid post id.", 144);
		const post = await originalPostId(raw);
		await sql`delete from bookmark_folder_posts where folder_id = ${sql.cast(f.id, "bigint")} and post_id = ${sql.cast(post, "bigint")}`;
		return { data: { bookmark_collection_tweet_delete: "Done" } };
	},
	BookmarkFolderTimeline: async (v: Viewer, vars: Vars) => {
		const f = await mine(v.id, folderId(vars));
		const posts = vars.cursor ? [] : await folderPosts(v.id, f.id);
		const base = BigInt(newId());
		const entries: unknown[] = posts.map((p, i) => tweetEntry(p, (base - BigInt(i) - 1n).toString()));
		entries.push(cursorEntry("Top", "t0", base.toString()));
		entries.push(cursorEntry("Bottom", "b0", (base - BigInt(posts.length) - 2n).toString()));
		return { data: { bookmark_collection_timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }], responseObjects: {} } } } };
	},
};
