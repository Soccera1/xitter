// Backend-native triggers. Structural definitions live in ../schema.ts.
import type { Dialect } from "./schema-types";
export const schemaEffects: Record<Dialect, string[]> = {
	postgres: [
		String.raw`create or replace function user_stats_posts() returns trigger language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		insert into user_stats (user_id, posts, articles)
			select user_id, count(*), count(article_id) from new_rows group by user_id
			on conflict (user_id) do update set posts = user_stats.posts + excluded.posts, articles = user_stats.articles + excluded.articles;
	else
		update user_stats s set posts = s.posts - d.posts, articles = s.articles - d.articles
			from (select user_id, count(*) as posts, count(article_id) as articles from old_rows group by user_id) d where s.user_id = d.user_id;
	end if;
	return null;
end $$;`,
		String.raw`create or replace trigger user_stats_posts_insert after insert on posts referencing new table as new_rows for each statement execute function user_stats_posts();`,
		String.raw`create or replace trigger user_stats_posts_delete after delete on posts referencing old table as old_rows for each statement execute function user_stats_posts();`,
		String.raw`create or replace function user_stats_likes() returns trigger language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		insert into user_stats (user_id, likes) select user_id, count(*) from new_rows group by user_id
			on conflict (user_id) do update set likes = user_stats.likes + excluded.likes;
	else
		update user_stats s set likes = s.likes - d.n from (select user_id, count(*) as n from old_rows group by user_id) d where s.user_id = d.user_id;
	end if;
	return null;
end $$;`,
		String.raw`create or replace trigger user_stats_likes_insert after insert on likes referencing new table as new_rows for each statement execute function user_stats_likes();`,
		String.raw`create or replace trigger user_stats_likes_delete after delete on likes referencing old table as old_rows for each statement execute function user_stats_likes();`,
		String.raw`create or replace function user_stats_highlights() returns trigger language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		insert into user_stats (user_id, highlights) select user_id, count(*) from new_rows group by user_id
			on conflict (user_id) do update set highlights = user_stats.highlights + excluded.highlights;
	else
		update user_stats s set highlights = s.highlights - d.n from (select user_id, count(*) as n from old_rows group by user_id) d where s.user_id = d.user_id;
	end if;
	return null;
end $$;`,
		String.raw`create or replace trigger user_stats_highlights_insert after insert on highlights referencing new table as new_rows for each statement execute function user_stats_highlights();`,
		String.raw`create or replace trigger user_stats_highlights_delete after delete on highlights referencing old table as old_rows for each statement execute function user_stats_highlights();`,
		String.raw`create or replace function user_stats_follows() returns trigger language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		insert into user_stats (user_id, followers, following)
			select id, sum(followers), sum(following) from (
				select followee_id as id, 1 as followers, 0 as following from new_rows
				union all select follower_id, 0, 1 from new_rows
			) x group by id
			on conflict (user_id) do update set followers = user_stats.followers + excluded.followers, following = user_stats.following + excluded.following;
	else
		update user_stats s set followers = s.followers - d.followers, following = s.following - d.following
			from (select id, sum(followers) as followers, sum(following) as following from (
				select followee_id as id, 1 as followers, 0 as following from old_rows
				union all select follower_id, 0, 1 from old_rows
			) x group by id) d where s.user_id = d.id;
	end if;
	return null;
end $$;`,
		String.raw`create or replace trigger user_stats_follows_insert after insert on follows referencing new table as new_rows for each statement execute function user_stats_follows();`,
		String.raw`create or replace trigger user_stats_follows_delete after delete on follows referencing old table as old_rows for each statement execute function user_stats_follows();`,
		String.raw`create or replace function user_stats_media() returns trigger language plpgsql as $$
declare
	affected bigint[];
begin
	if tg_op = 'INSERT' then
		select array_agg(distinct user_id) into affected from new_rows where post_id is not null;
	elsif tg_op = 'DELETE' then
		select array_agg(distinct user_id) into affected from old_rows where post_id is not null;
	else
		select array_agg(distinct n.user_id) into affected from new_rows n join old_rows o on o.id = n.id where n.post_id is distinct from o.post_id;
	end if;
	if affected is null then return null; end if;
	insert into user_stats (user_id, media_posts)
		select a, (select count(distinct m.post_id) from media m where m.user_id = a and m.post_id is not null)
		from unnest(affected) a where exists (select 1 from users where id = a)
		on conflict (user_id) do update set media_posts = excluded.media_posts;
	return null;
end $$;`,
		String.raw`create or replace trigger user_stats_media_insert after insert on media referencing new table as new_rows for each statement execute function user_stats_media();`,
		String.raw`create or replace trigger user_stats_media_update after update on media referencing new table as new_rows old table as old_rows for each statement execute function user_stats_media();`,
		String.raw`create or replace trigger user_stats_media_delete after delete on media referencing old table as old_rows for each statement execute function user_stats_media();`,
	],
	sqlite: [
		String.raw`create trigger if not exists user_stats_posts_insert after insert on posts begin
	insert into user_stats (user_id, posts) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set posts = posts + excluded.posts;
	insert into user_stats (user_id, articles) select new.user_id, (new.article_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set articles = articles + excluded.articles;
end;`,
		String.raw`create trigger if not exists user_stats_posts_delete after delete on posts begin
	update user_stats set posts = posts - (1) where user_id = old.user_id;
	update user_stats set articles = articles - (old.article_id is not null) where user_id = old.user_id;
end;`,
		String.raw`create trigger if not exists user_stats_likes_insert after insert on likes begin
	insert into user_stats (user_id, likes) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set likes = likes + excluded.likes;
end;`,
		String.raw`create trigger if not exists user_stats_likes_delete after delete on likes begin
	update user_stats set likes = likes - (1) where user_id = old.user_id;
end;`,
		String.raw`create trigger if not exists user_stats_highlights_insert after insert on highlights begin
	insert into user_stats (user_id, highlights) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set highlights = highlights + excluded.highlights;
end;`,
		String.raw`create trigger if not exists user_stats_highlights_delete after delete on highlights begin
	update user_stats set highlights = highlights - (1) where user_id = old.user_id;
end;`,
		String.raw`create trigger if not exists user_stats_follows_insert after insert on follows begin
	insert into user_stats (user_id, followers) select new.followee_id, (1) where exists (select 1 from users where id = new.followee_id) on conflict(user_id) do update set followers = followers + excluded.followers;
	insert into user_stats (user_id, following) select new.follower_id, (1) where exists (select 1 from users where id = new.follower_id) on conflict(user_id) do update set following = following + excluded.following;
end;`,
		String.raw`create trigger if not exists user_stats_follows_delete after delete on follows begin
	update user_stats set followers = followers - (1) where user_id = old.followee_id;
	update user_stats set following = following - (1) where user_id = old.follower_id;
end;`,
		String.raw`create trigger if not exists user_stats_media_insert after insert on media begin
	insert into user_stats(user_id, media_posts) select new.user_id, (select count(distinct post_id) from media where user_id = new.user_id and post_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;`,
		String.raw`create trigger if not exists user_stats_media_delete after delete on media begin
	insert into user_stats(user_id, media_posts) select old.user_id, (select count(distinct post_id) from media where user_id = old.user_id and post_id is not null) where exists (select 1 from users where id = old.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;`,
		String.raw`create trigger if not exists user_stats_media_update after update on media begin
	insert into user_stats(user_id, media_posts) select old.user_id, (select count(distinct post_id) from media where user_id = old.user_id and post_id is not null) where exists (select 1 from users where id = old.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
	insert into user_stats(user_id, media_posts) select new.user_id, (select count(distinct post_id) from media where user_id = new.user_id and post_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;`,
	],
};
