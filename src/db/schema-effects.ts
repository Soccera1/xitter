// Backend-native triggers for the shared schema.
import type { Dialect } from "./schema-types";
export const schemaEffects: Record<Dialect, string[]> = {
	postgres: [
		String.raw`create or replace function media_detached() returns trigger language plpgsql as $$
begin
	if old.post_id is not null and new.post_id is null then new.detached := true; end if;
	return new;
end $$;`,
		String.raw`create or replace trigger media_detached before update of post_id on media for each row execute function media_detached();`,
		String.raw`create or replace function affiliations_cap() returns trigger language plpgsql as $$
begin
	perform 1 from users where id = new.user_id for update;
	if (select count(*) from affiliations where user_id = new.user_id) >= 4 then
		raise exception 'affiliation_limit' using errcode = 'P0001';
	end if;
	return new;
end $$;`,
		String.raw`create or replace trigger affiliations_cap before insert on affiliations for each row execute function affiliations_cap();`,
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
		String.raw`create or replace function federation_local(uid bigint) returns boolean language sql stable as $$
	select exists (select 1 from users where id = uid and instance is null)
$$;`,
		String.raw`create or replace function federation_post_changed() returns trigger language plpgsql as $$
begin
	if tg_op = 'DELETE' then
		if federation_local(old.user_id) then insert into federation_outbox (kind, a) values ('post', old.id); end if;
		return old;
	end if;
	if federation_local(new.user_id) then insert into federation_outbox (kind, a) values ('post', new.id); end if;
	return new;
end $$;`,
		String.raw`create or replace trigger federation_post_insert after insert on posts for each row execute function federation_post_changed();`,
		String.raw`create or replace trigger federation_post_update after update of text, hidden, edited_at, sensitive, count_overrides on posts for each row
	when (old.text is distinct from new.text or old.hidden is distinct from new.hidden or old.edited_at is distinct from new.edited_at or old.sensitive is distinct from new.sensitive
		or old.count_overrides is distinct from new.count_overrides)
	execute function federation_post_changed();`,
		String.raw`create or replace trigger federation_post_delete before delete on posts for each row execute function federation_post_changed();`,
		String.raw`create or replace function federation_pair_changed() returns trigger language plpgsql as $$
declare
	actor bigint;
	target bigint;
begin
	if tg_table_name = 'follows' then
		actor := coalesce(new.follower_id, old.follower_id);
		target := coalesce(new.followee_id, old.followee_id);
	else
		actor := coalesce(new.user_id, old.user_id);
		target := coalesce(new.post_id, old.post_id);
	end if;
	if federation_local(actor) then
		insert into federation_outbox (kind, a, b) values (case tg_table_name when 'likes' then 'like' when 'reposts' then 'repost' else 'follow' end, actor, target);
	end if;
	return null;
end $$;`,
		String.raw`create or replace trigger federation_like_change after insert or delete on likes for each row execute function federation_pair_changed();`,
		String.raw`create or replace trigger federation_repost_change after insert or delete on reposts for each row execute function federation_pair_changed();`,
		String.raw`create or replace trigger federation_follow_change after insert or delete on follows for each row execute function federation_pair_changed();`,
		String.raw`create or replace function federation_user_changed() returns trigger language plpgsql as $$
begin
	if tg_op = 'DELETE' then
		if old.instance is null then insert into federation_outbox (kind, a) values ('user', old.id); end if;
		return old;
	end if;
	if new.instance is null then insert into federation_outbox (kind, a) values ('user', new.id); end if;
	return new;
end $$;`,
		String.raw`create or replace trigger federation_user_insert after insert on users for each row execute function federation_user_changed();`,
		String.raw`create or replace trigger federation_user_update after update of screen_name, name, bio, location, website, avatar_url, banner_url, protected, status, deactivated_at, verified_type, translator, flag, parody_label, count_overrides, decoration on users for each row
	when (old.screen_name is distinct from new.screen_name or old.name is distinct from new.name or old.bio is distinct from new.bio or old.location is distinct from new.location or old.website is distinct from new.website
		or old.avatar_url is distinct from new.avatar_url or old.banner_url is distinct from new.banner_url or old.protected is distinct from new.protected
		or old.status is distinct from new.status or old.deactivated_at is distinct from new.deactivated_at or old.verified_type is distinct from new.verified_type
		or old.translator is distinct from new.translator or old.flag is distinct from new.flag or old.parody_label is distinct from new.parody_label
		or old.count_overrides is distinct from new.count_overrides or old.decoration is distinct from new.decoration)
	execute function federation_user_changed();`,
		String.raw`create or replace function federation_badges_changed() returns trigger language plpgsql as $$
begin
	insert into federation_outbox (kind, a) select 'user', u.id from users u where u.id = coalesce(new.user_id, old.user_id) and u.instance is null;
	return null;
end $$;`,
		String.raw`create or replace trigger federation_user_badges after insert or delete on user_badges for each row execute function federation_badges_changed();`,
		String.raw`create or replace trigger federation_user_delete before delete on users for each row execute function federation_user_changed();`,
		String.raw`create or replace function federated_object_gone() returns trigger language plpgsql as $$
begin
	delete from federated_objects where kind = tg_argv[0] and local_id = old.id;
	return old;
end $$;`,
		String.raw`create or replace trigger federated_user_gone after delete on users for each row when (old.instance is not null) execute function federated_object_gone('user');`,
		String.raw`create or replace trigger federated_post_gone after delete on posts for each row execute function federated_object_gone('post');`,
		String.raw`create or replace trigger federated_media_gone after delete on media for each row when (old.remote_instance is not null) execute function federated_object_gone('media');`,
		String.raw`create or replace function blocks_spare_admins() returns trigger language plpgsql as $$
begin
	if exists (select 1 from users b join users t on t.id = new.blocked_id where b.id = new.blocker_id and b.instance is null and t.role = 'admin' and t.instance is null) then
		return null;
	end if;
	return new;
end $$;`,
		String.raw`create or replace trigger blocks_spare_admins before insert on blocks for each row execute function blocks_spare_admins();`,
		String.raw`create or replace function admins_unblocked() returns trigger language plpgsql as $$
begin
	if new.role = 'admin' and old.role is distinct from 'admin' and new.instance is null then
		delete from blocks bl using users b where bl.blocked_id = new.id and b.id = bl.blocker_id and b.instance is null;
	end if;
	return new;
end $$;`,
		String.raw`create or replace trigger users_admins_unblocked after update of role on users for each row execute function admins_unblocked();`,
		String.raw`insert into federation_outbox (kind, a) select 'user', id from users where instance is null and not exists (select 1 from schema_steps where name = 'federation_backfill') order by id`,
		String.raw`insert into federation_outbox (kind, a) select 'post', p.id from posts p join users u on u.id = p.user_id where u.instance is null and not u.protected and p.created_at > now() - interval '30 days' and not exists (select 1 from schema_steps where name = 'federation_backfill') order by p.id`,
		String.raw`insert into schema_steps (name) values ('federation_backfill') on conflict do nothing`,
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
		String.raw`create trigger affiliations_cap before insert on affiliations when (select count(*) from affiliations where user_id = new.user_id) >= 4 begin select raise(abort, 'affiliation_limit'); end;`,
		String.raw`create trigger federation_post_insert after insert on posts for each row when exists (select 1 from users where id = new.user_id and instance is null) begin insert into federation_outbox (kind, a) values ('post', new.id); end;`,
		String.raw`create trigger federation_post_update after update of text, hidden, edited_at, sensitive, count_overrides on posts for each row when exists (select 1 from users where id = new.user_id and instance is null) and (old.text is not new.text or old.hidden is not new.hidden or old.edited_at is not new.edited_at or old.sensitive is not new.sensitive or old.count_overrides is not new.count_overrides) begin insert into federation_outbox (kind, a) values ('post', new.id); end;`,
		String.raw`create trigger federation_post_delete before delete on posts for each row when exists (select 1 from users where id = old.user_id and instance is null) begin insert into federation_outbox (kind, a) values ('post', old.id); end;`,
		String.raw`create trigger federation_user_insert after insert on users for each row when new.instance is null begin insert into federation_outbox (kind, a) values ('user', new.id); end;`,
		String.raw`create trigger federation_user_update after update of screen_name, name, bio, location, website, avatar_url, banner_url, protected, status, deactivated_at, verified_type, translator, flag, parody_label, count_overrides, decoration on users for each row when new.instance is null and (old.screen_name is not new.screen_name or old.name is not new.name or old.bio is not new.bio or old.location is not new.location or old.website is not new.website or old.avatar_url is not new.avatar_url or old.banner_url is not new.banner_url or old.protected is not new.protected or old.status is not new.status or old.deactivated_at is not new.deactivated_at or old.verified_type is not new.verified_type or old.translator is not new.translator or old.flag is not new.flag or old.parody_label is not new.parody_label or old.count_overrides is not new.count_overrides or old.decoration is not new.decoration) begin insert into federation_outbox (kind, a) values ('user', new.id); end;`,
		String.raw`create trigger federation_user_delete before delete on users for each row when old.instance is null begin insert into federation_outbox (kind, a) values ('user', old.id); end;`,
		String.raw`create trigger federation_like_insert after insert on likes for each row when exists (select 1 from users where id = new.user_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('like', new.user_id, new.post_id); end;`,
		String.raw`create trigger federation_like_delete after delete on likes for each row when exists (select 1 from users where id = old.user_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('like', old.user_id, old.post_id); end;`,
		String.raw`create trigger federation_repost_insert after insert on reposts for each row when exists (select 1 from users where id = new.user_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('repost', new.user_id, new.post_id); end;`,
		String.raw`create trigger federation_repost_delete after delete on reposts for each row when exists (select 1 from users where id = old.user_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('repost', old.user_id, old.post_id); end;`,
		String.raw`create trigger federation_follow_insert after insert on follows for each row when exists (select 1 from users where id = new.follower_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('follow', new.follower_id, new.followee_id); end;`,
		String.raw`create trigger federation_follow_delete after delete on follows for each row when exists (select 1 from users where id = old.follower_id and instance is null) begin insert into federation_outbox (kind, a, b) values ('follow', old.follower_id, old.followee_id); end;`,
		String.raw`create trigger federation_badges_insert after insert on user_badges for each row begin insert into federation_outbox (kind, a) select 'user', id from users where id = new.user_id and instance is null; end;`,
		String.raw`create trigger federation_badges_delete after delete on user_badges for each row begin insert into federation_outbox (kind, a) select 'user', id from users where id = old.user_id and instance is null; end;`,
		String.raw`create trigger federated_user_gone after delete on users for each row when old.instance is not null begin delete from federated_objects where kind = 'user' and local_id = old.id; end;`,
		String.raw`create trigger federated_post_gone after delete on posts for each row when true begin delete from federated_objects where kind = 'post' and local_id = old.id; end;`,
		String.raw`create trigger federated_media_gone after delete on media for each row when old.remote_instance is not null begin delete from federated_objects where kind = 'media' and local_id = old.id; end;`,
		String.raw`create trigger blocks_spare_admins before insert on blocks for each row when exists (select 1 from users b join users t on t.id = new.blocked_id where b.id = new.blocker_id and b.instance is null and t.role = 'admin' and t.instance is null) begin select raise(ignore); end;`,
		String.raw`create trigger users_admins_unblocked after update of role on users for each row when new.role = 'admin' and old.role is not 'admin' and new.instance is null begin delete from blocks where blocked_id = new.id and blocker_id in (select id from users where instance is null); end;`,
		String.raw`insert into federation_outbox (kind, a) select 'user', id from users where instance is null and not exists (select 1 from schema_steps where name = 'federation_backfill') order by id`,
		String.raw`insert into federation_outbox (kind, a) select 'post', p.id from posts p join users u on u.id = p.user_id where u.instance is null and not u.protected and p.created_at > now() - 2592000000 and not exists (select 1 from schema_steps where name = 'federation_backfill') order by p.id`,
		String.raw`insert into schema_steps (name) values ('federation_backfill') on conflict do nothing`,
	],
};
