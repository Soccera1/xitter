-- SQLite schema version 1. Keep feature/schema changes in sync with schema.sql.
-- Timestamps are UTC epoch milliseconds; arrays are JSON text.

create table if not exists users (
	id bigint not null primary key,
	screen_name text not null,
	name text not null,
	password_hash text not null,
	bio text not null default '',
	location text not null default '',
	avatar_url text,
	banner_url text,
	verified_type text check (verified_type in ('blue', 'business', 'government', 'government_individual')),
	created_at timestamptz not null default (now()),
	education_flags jsonb not null default '{}',
	preferences jsonb not null default '{}',
	country text,
	status_until timestamptz,
	deactivated_at timestamptz,
	language text not null default 'en',
	email text,
	totp_enabled boolean not null default false,
	totp_secret text,
	totp_pending text,
	totp_backup jsonb not null default '[]',
	email_settings jsonb not null default '{}',
	status_restore text,
	notes_writer boolean not null default false,
	notes_alias text not null default ('Contributor-' || substr(replace(gen_random_uuid(), '-', ''), 1, 12)),
	website text not null default '',
	pinned_post_id bigint references posts (id) on delete set null,
	notifications_seen_at timestamptz not null default (now()),
	invite_code text references invites (code) on delete set null,
	flag text,
	role text check (role in ('admin', 'moderator', 'support')),
	status text not null default 'active'
	check (status in ('active', 'restricted', 'limited', 'suspended')),
	last_seen_at timestamptz,
	verified_at timestamptz,
	org_badge_id bigint references custom_badges(id) on delete set null,
	protected boolean not null default false,
	signup_source text,
	signup_country text,
	based_in_override text,
	activity_mailed_at timestamptz,
	messages_mailed_at timestamptz,
	activity_checked_at timestamptz,
	messages_checked_at timestamptz,
	translator text check (translator in ('translator', 'moderator', 'approver')),
	email_verified boolean not null default false,
	count_overrides jsonb,
	delegation_invites text not null default 'Everyone'
	check (delegation_invites in ('Nobody', 'Everyone', 'OnlyFollowing')),
	automated_by bigint references users (id) on delete set null,
	parody_label text not null default 'None'
	check (parody_label in ('None', 'Parody', 'Commentary', 'Fan')),
	parody_label_at timestamptz,
	label_id bigint references account_labels(id) on delete set null,
	role_granted_by bigint
);

create table if not exists sessions (
	token text not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	csrf text not null,
	created_at timestamptz not null default (now()),
	id uuid not null default (gen_random_uuid()),
	last_seen_at timestamptz not null default (now()),
	user_agent text,
	ip text
);

create table if not exists posts (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	text text not null,
	reply_to_id bigint,
	conversation_id bigint not null,
	created_at timestamptz not null default (now()),
	reply_to_user_id bigint,
	reply_policy text,
	hidden boolean not null default false,
	sensitive boolean not null default false,
	source text not null default 'Xitter for Web',
	quote_id bigint references posts (id) on delete set null,
	article_id bigint references articles (id) on delete set null,
	community_id bigint references communities (id) on delete set null,
	poll_id bigint references polls (id) on delete set null,
	place_id text,
	edit_count int not null default 0,
	edited_at timestamptz,
	pinned_reply_id bigint references posts (id) on delete set null,
	notice jsonb,
	count_overrides jsonb,
	reply_hidden_at timestamptz
);

create table if not exists custom_badges (
	id bigint not null primary key,
	name text not null check(length(name) between 1 and 60),
	image bytea not null,
	mime text not null,
	created_at timestamptz not null default (now())
);

create table if not exists user_badges (
	user_id bigint not null references users(id) on delete cascade,
	badge_id bigint not null references custom_badges(id) on delete cascade,
	position integer not null default 0,
	primary key (user_id, badge_id)
);

create table if not exists login_challenges (
	token uuid not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	attempts int not null default 0,
	created_at timestamptz not null default (now())
);

create table if not exists post_views (
	post_id bigint not null references posts (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (post_id, user_id)
);

create table if not exists password_resets (
	token_hash text not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	used boolean not null default false,
	created_at timestamptz not null default (now())
);

create table if not exists data_exports (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	body jsonb not null,
	created_at timestamptz not null default (now())
);

create table if not exists staff_notes (
	id bigint not null primary key,
	user_id bigint not null references users(id) on delete cascade,
	actor_id bigint references users(id) on delete set null,
	body text not null check(length(body) between 1 and 2000),
	created_at timestamptz not null default (now())
);

create table if not exists staff_messages (
	id bigint not null primary key,
	user_id bigint not null references users(id) on delete cascade,
	actor_id bigint references users(id) on delete set null,
	kind text not null check(kind in ('message','warning','strike')),
	body text not null check(length(body) between 1 and 2000),
	created_at timestamptz not null default (now()),
	read_at timestamptz,
	revoked_at timestamptz
);

create table if not exists moderation_appeals (
	id bigint not null primary key,
	user_id bigint not null references users(id) on delete cascade,
	message_id bigint references staff_messages(id) on delete set null,
	body text not null,
	status text not null default 'open' check(status in ('open','accepted','rejected')),
	staff_reply text,
	reviewer_id bigint references users(id) on delete set null,
	created_at timestamptz not null default (now()),
	resolved_at timestamptz
);

create table if not exists client_platforms (
	id bigint not null primary key,
	label text not null check (length(label) between 1 and 80),
	token_hash text not null unique,
	creator_id bigint references users(id) on delete set null,
	revoked boolean not null default false,
	created_at timestamptz not null default (now())
);

create table if not exists community_notes (
	id bigint not null primary key,
	post_id bigint not null references posts(id) on delete cascade,
	author_id bigint not null references users(id) on delete cascade,
	text text not null check (length(text) between 1 and 500),
	classification text not null check (classification in ('Misleading', 'NotMisleading')),
	created_at timestamptz not null default (now()),
	data_v1 jsonb not null default '{}',
	unique(post_id, author_id)
);

create table if not exists community_note_ratings (
	note_id bigint not null references community_notes(id) on delete cascade,
	user_id bigint not null references users(id) on delete cascade,
	rating text not null check (rating in ('Helpful', 'SomewhatHelpful', 'NotHelpful')),
	data_v2 jsonb not null default '{}',
	primary key(note_id, user_id)
);

create table if not exists community_note_requests (
	post_id bigint not null references posts(id) on delete cascade,
	user_id bigint not null references users(id) on delete cascade,
	created_at timestamptz not null default (now()),
	source_link text,
	suggestion text,
	primary key(post_id, user_id)
);

create table if not exists likes (
	user_id bigint not null references users (id) on delete cascade,
	post_id bigint not null references posts (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, post_id)
);

create table if not exists reposts (
	id bigint not null,
	user_id bigint not null references users (id) on delete cascade,
	post_id bigint not null references posts (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, post_id)
);

create table if not exists bookmarks (
	user_id bigint not null references users (id) on delete cascade,
	post_id bigint not null references posts (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, post_id)
);

create table if not exists highlights (
	user_id bigint not null references users (id) on delete cascade,
	post_id bigint not null references posts (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, post_id)
);

create table if not exists follows (
	follower_id bigint not null references users (id) on delete cascade,
	followee_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (follower_id, followee_id),
	check (follower_id <> followee_id)
);

create table if not exists media (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	kind text not null,
	mime text not null,
	size integer not null,
	width integer not null,
	height integer not null,
	post_id bigint references posts (id) on delete set null,
	position smallint,
	created_at timestamptz not null default (now()),
	duration_ms integer,
	state text not null default 'ready',
	alt_text text,
	sensitive_warning json_array
);

create table if not exists articles (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	title text not null default '',
	content_state jsonb,
	plain_text text not null default '',
	cover_media_id bigint references media (id) on delete set null,
	state text not null default 'Draft',
	created_at timestamptz not null default (now()),
	modified_at timestamptz not null default (now()),
	first_published_at timestamptz,
	hidden boolean not null default false
);

create table if not exists post_mentions (
	post_id bigint not null references posts (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	primary key (post_id, user_id)
);

create table if not exists blocks (
	blocker_id bigint not null references users (id) on delete cascade,
	blocked_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (blocker_id, blocked_id)
);

create table if not exists mutes (
	muter_id bigint not null references users (id) on delete cascade,
	muted_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (muter_id, muted_id)
);

create table if not exists muted_keywords (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	keyword text not null,
	surfaces json_array not null,
	exclude_following boolean not null default false,
	valid_until timestamptz,
	created_at timestamptz not null default (now())
);

create table if not exists invites (
	code text not null primary key,
	created_by bigint references users (id) on delete set null,
	max_uses integer not null default 1,
	uses integer not null default 0,
	expires_at timestamptz,
	created_at timestamptz not null default (now()),
	org_id bigint references users (id) on delete set null,
	revoked boolean not null default false
);

create table if not exists audit_log (
	id bigint not null primary key,
	actor_id bigint references users (id) on delete set null,
	action text not null,
	target text,
	detail jsonb,
	created_at timestamptz not null default (now())
);

create table if not exists affiliations (
	org_id bigint not null references users (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	manager boolean not null default false,
	primary key (org_id, user_id)
);

create table if not exists settings (
	key text not null primary key,
	value jsonb not null
);

create table if not exists reports (
	id bigint not null primary key,
	reporter_id bigint references users (id) on delete set null,
	post_id bigint references posts (id) on delete set null,
	user_id bigint references users (id) on delete cascade,
	reason text not null,
	details text not null default '',
	status text not null default 'open',
	handled_by bigint references users (id) on delete set null,
	handled_at timestamptz,
	note text not null default '',
	created_at timestamptz not null default (now())
);

create table if not exists schema_steps (
	name text not null primary key,
	done_at timestamptz not null default (now())
);

create table if not exists username_changes (
	user_id bigint not null references users (id) on delete cascade,
	old_name text not null,
	new_name text not null,
	changed_at timestamptz not null default (now())
);

create table if not exists signup_sessions (
	token uuid not null primary key,
	username text not null,
	code text not null default '',
	created_at timestamptz not null default (now()),
	pending jsonb,
	email_code_hash text,
	email_code_at timestamptz,
	email_attempts integer not null default 0
);

create table if not exists chat_keys (
	user_id bigint not null references users (id) on delete cascade,
	version bigint not null,
	public_key text not null,
	signing_public_key text not null,
	identity_public_key_signature text not null default '',
	registration_method text not null default 'CustomPin',
	created_at timestamptz not null default (now()),
	primary key (user_id, version)
);

create table if not exists chat_members (
	conversation_id text not null,
	user_id bigint not null references users (id) on delete cascade,
	joined_at timestamptz not null default (now()),
	accepted boolean not null default true,
	archived boolean not null default false,
	muted boolean not null default false,
	deleted_before bigint not null default 0,
	primary key (conversation_id, user_id)
);

create table if not exists chat_events (
	seq bigint not null primary key,
	conversation_id text not null,
	sender_id bigint not null references users (id) on delete cascade,
	kind smallint not null,
	event bytea not null,
	created_at timestamptz not null default (now()),
	audience_id bigint references users(id) on delete cascade,
	deleted boolean not null default false
);

create table if not exists chat_conversations (
	id text not null primary key,
	creator_id bigint not null references users(id) on delete cascade,
	metadata jsonb not null default '{}',
	created boolean not null default false
);

create table if not exists chat_trust (
	user_id bigint not null references users(id) on delete cascade,
	trusted_id bigint not null references users(id) on delete cascade,
	primary key (user_id, trusted_id)
);

create table if not exists chat_hidden_events (
	user_id bigint not null references users(id) on delete cascade,
	seq bigint not null references chat_events(seq) on delete cascade,
	primary key (user_id, seq)
);

create table if not exists chat_uploads (
	hash text not null primary key,
	resume_id bigint not null unique,
	conversation_id text not null,
	message_id text not null,
	uploader_id bigint not null references users(id) on delete cascade,
	total_bytes bigint not null check (total_bytes > 0),
	ready boolean not null default false,
	expires_at timestamptz,
	created_at timestamptz not null default (now())
);

create table if not exists lists (
	id bigint not null primary key,
	owner_id bigint not null references users (id) on delete cascade,
	name text not null,
	description text not null default '',
	is_private boolean not null default false,
	created_at timestamptz not null default (now()),
	banner_media_id bigint
);

create table if not exists list_members (
	list_id bigint not null references lists (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (list_id, user_id)
);

create table if not exists list_subscribers (
	list_id bigint not null references lists (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (list_id, user_id)
);

create table if not exists list_mutes (
	list_id bigint not null references lists (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	primary key (list_id, user_id)
);

create table if not exists pinned_lists (
	user_id bigint not null references users (id) on delete cascade,
	list_id bigint not null references lists (id) on delete cascade,
	position int not null default 0,
	primary key (user_id, list_id)
);

create table if not exists communities (
	id bigint not null primary key,
	creator_id bigint not null references users (id) on delete cascade,
	name text not null,
	description text not null default '',
	question text not null default '',
	join_policy text not null default 'Open',
	invites_policy text not null default 'MemberInvitesAllowed',
	is_nsfw boolean not null default false,
	banner_url text,
	created_at timestamptz not null default (now()),
	banner_width integer,
	banner_height integer,
	topic_id bigint references topics (id) on delete set null
);

create table if not exists community_members (
	community_id bigint not null references communities (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	role text not null default 'Member' check (role in ('Member', 'Moderator', 'Admin')),
	created_at timestamptz not null default (now()),
	primary key (community_id, user_id)
);

create table if not exists community_rules (
	id bigint not null primary key,
	community_id bigint not null references communities (id) on delete cascade,
	name text not null,
	description text not null default '',
	position int not null default 0
);

create table if not exists community_join_requests (
	community_id bigint not null references communities (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	answer text not null default '',
	created_at timestamptz not null default (now()),
	primary key (community_id, user_id)
);

create table if not exists polls (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	choices json_array not null,
	duration_minutes int not null,
	ends_at timestamptz,
	created_at timestamptz not null default (now()),
	choice_media json_array
);

create table if not exists poll_votes (
	poll_id bigint not null references polls (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	choice smallint not null,
	created_at timestamptz not null default (now()),
	primary key (poll_id, user_id)
);

create table if not exists scheduled_posts (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	kind text not null check (kind in ('scheduled', 'draft')),
	execute_at timestamptz,
	request jsonb not null,
	created_at timestamptz not null default (now())
);

create table if not exists post_versions (
	version_id bigint not null primary key,
	post_id bigint not null references posts (id) on delete cascade,
	seq int not null,
	text text not null,
	created_at timestamptz not null
);

create table if not exists follow_requests (
	requester_id bigint not null references users (id) on delete cascade,
	target_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (requester_id, target_id),
	check (requester_id <> target_id)
);

create table if not exists bookmark_folders (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	name text not null,
	created_at timestamptz not null default (now())
);

create table if not exists bookmark_folder_posts (
	folder_id bigint not null references bookmark_folders (id) on delete cascade,
	post_id bigint not null references posts (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (folder_id, post_id)
);

create table if not exists topics (
	id bigint not null primary key,
	name text not null check (length(name) between 1 and 50),
	description text not null default '',
	keywords json_array not null,
	created_at timestamptz not null default (now())
);

create table if not exists topic_follows (
	user_id bigint not null references users (id) on delete cascade,
	topic_id bigint not null references topics (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, topic_id)
);

create table if not exists topic_not_interested (
	user_id bigint not null references users (id) on delete cascade,
	topic_id bigint not null references topics (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, topic_id)
);

create table if not exists post_notifications (
	user_id bigint not null references users (id) on delete cascade,
	target_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, target_id)
);

create table if not exists repost_mutes (
	user_id bigint not null references users (id) on delete cascade,
	target_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now()),
	primary key (user_id, target_id)
);

create table if not exists contacts (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	vcard text not null,
	emails json_array not null default '[]',
	created_at timestamptz not null default (now())
);

create table if not exists explore_cards (
	id bigint not null primary key,
	kind text not null check (kind in ('news', 'sports')),
	title text not null,
	summary text not null default '',
	category text not null default '',
	query text not null,
	image bytea,
	image_mime text,
	image_width integer,
	image_height integer,
	home text not null default '',
	away text not null default '',
	home_score text not null default '',
	away_score text not null default '',
	state text check (state in ('Scheduled', 'InProgress', 'Completed', 'Postponed', 'Cancelled')),
	clock text not null default '',
	starts_at timestamptz,
	ends_at timestamptz,
	hidden boolean not null default false,
	position integer not null default 0,
	created_at timestamptz not null default (now())
);

create table if not exists login_events (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	ip text,
	country text,
	app text not null,
	user_agent text,
	created_at timestamptz not null default (now())
);

create table if not exists mail_log (
	id bigint not null primary key,
	user_id bigint references users (id) on delete set null,
	to_addr text not null,
	kind text not null,
	subject text not null,
	status text not null check (status in ('sent', 'failed', 'skipped')),
	error text,
	created_at timestamptz not null default (now())
);

create table if not exists push_subscriptions (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	endpoint text not null unique,
	p256dh text not null,
	auth text not null,
	settings jsonb not null default '{}',
	last_pushed_at timestamptz not null default (now()),
	created_at timestamptz not null default (now())
);

create table if not exists email_confirmations (
	token_hash text not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	email text not null,
	used boolean not null default false,
	created_at timestamptz not null default (now())
);

create table if not exists error_log (
	fingerprint text not null primary key,
	source text not null check (source in ('server', 'client', 'job')),
	message text not null,
	stack text,
	path text,
	user_id bigint,
	count integer not null default 1,
	first_at timestamptz not null default (now()),
	last_at timestamptz not null default (now()),
	resolved boolean not null default false
);

create table if not exists affiliation_requests (
	org_id bigint not null references users (id) on delete cascade,
	user_id bigint not null references users (id) on delete cascade,
	requested_by bigint references users (id) on delete set null,
	created_at timestamptz not null default (now()),
	primary key (org_id, user_id)
);

create table if not exists unfollows (
	follower_id bigint not null references users (id) on delete cascade,
	followee_id bigint not null references users (id) on delete cascade,
	created_at timestamptz not null default (now())
);

create table if not exists profile_visits (
	profile_id bigint not null references users (id) on delete cascade,
	visitor_id bigint not null references users (id) on delete cascade,
	day date not null default current_date,
	created_at timestamptz not null default (now()),
	primary key (profile_id, visitor_id, day)
);

create table if not exists sticker_packs (
	id bigint not null primary key,
	name text not null check (length(name) between 1 and 40),
	position int not null default 0,
	created_at timestamptz not null default (now())
);

create table if not exists stickers (
	id bigint not null primary key,
	pack_id bigint not null references sticker_packs (id) on delete cascade,
	name text not null default '' check (length(name) <= 40),
	image bytea not null,
	mime text not null,
	position int not null default 0,
	created_at timestamptz not null default (now())
);

create table if not exists api_tokens (
	id bigint not null primary key,
	user_id bigint not null references users (id) on delete cascade,
	name text not null check (length(name) between 1 and 40),
	token_hash text not null unique,
	scope text not null check (scope in ('read', 'write')),
	created_at timestamptz not null default (now()),
	last_used_at timestamptz
);

create table if not exists hashflags (
	id bigint not null primary key,
	hashtag text not null,
	starts_at timestamptz not null,
	ends_at timestamptz not null,
	like_animation text,
	emoji bytea,
	emoji_mime text,
	hashfetti boolean not null default false,
	created_at timestamptz not null default (now()),
	check (ends_at > starts_at),
	check (like_animation is not null or emoji is not null)
);

create table if not exists delegation_members (
	id bigint not null primary key,
	owner_id bigint not null references users (id) on delete cascade,
	member_id bigint not null references users (id) on delete cascade,
	role text not null check (role in ('Admin', 'Contributor')),
	status text not null default 'Pending' check (status in ('Pending', 'Accepted')),
	invited_by bigint references users (id) on delete set null,
	created_at timestamptz not null default (now()),
	unique (owner_id, member_id),
	check (owner_id <> member_id)
);

create table if not exists link_previews (
	url text not null primary key,
	ok boolean not null,
	title text not null default '',
	description text not null default '',
	site text not null default '',
	image text,
	width int not null default 0,
	height int not null default 0,
	fetched_at timestamptz not null default (now())
);

create table if not exists retired_identities (
	kind text not null check (kind in ('handle', 'email', 'ip')),
	value text not null,
	user_id bigint,
	reason text not null default '',
	created_at timestamptz not null default (now()),
	primary key (kind, value)
);

create table if not exists account_labels (
	id bigint not null primary key,
	text text not null check (length(text) between 1 and 40),
	badge_id bigint references custom_badges(id) on delete set null,
	url text,
	created_at timestamptz not null default (now())
);

create table if not exists user_stats (
	user_id bigint not null primary key references users (id) on delete cascade,
	posts int not null default 0,
	articles int not null default 0,
	media_posts int not null default 0,
	likes int not null default 0,
	highlights int not null default 0,
	followers int not null default 0,
	following int not null default 0
);

create unique index if not exists users_screen_name_key on users (lower(screen_name));

create index if not exists posts_replies_idx on posts (reply_to_id, user_id);

create index if not exists posts_user_idx on posts (user_id, id desc);

create index if not exists posts_reply_user_idx on posts (reply_to_user_id, created_at) where reply_to_user_id is not null;

create index if not exists user_badges_badge_idx on user_badges(badge_id);

create unique index if not exists users_email_idx on users (lower(email));

create unique index if not exists sessions_id_key on sessions(id);

create index if not exists staff_notes_user_idx on staff_notes(user_id,id desc);

create index if not exists staff_notes_actor_idx on staff_notes(actor_id);

create index if not exists staff_messages_user_idx on staff_messages(user_id,id desc);

create index if not exists staff_messages_actor_idx on staff_messages(actor_id);

create index if not exists moderation_appeals_user_idx on moderation_appeals(user_id,id desc);

create index if not exists moderation_appeals_message_idx on moderation_appeals(message_id);

create index if not exists moderation_appeals_reviewer_idx on moderation_appeals(reviewer_id);

create unique index if not exists moderation_appeals_open_user_idx on moderation_appeals(user_id) where status='open';

create unique index if not exists users_notes_alias_key on users(notes_alias);

create index if not exists client_platforms_creator_idx on client_platforms(creator_id);

create index if not exists community_notes_author_idx on community_notes(author_id);

create index if not exists community_note_ratings_user_idx on community_note_ratings(user_id);

create index if not exists community_note_requests_user_idx on community_note_requests(user_id);

create index if not exists likes_post_user_idx on likes (post_id, user_id);

create index if not exists likes_created_idx on likes (created_at);

create index if not exists reposts_post_user_idx on reposts (post_id, user_id);

create index if not exists reposts_created_idx on reposts (created_at);

create index if not exists reposts_id_idx on reposts (id);

create index if not exists bookmarks_post_idx on bookmarks (post_id);

create index if not exists follows_followee_created_idx on follows (followee_id, created_at);

create index if not exists media_post_idx on media (post_id, position);

create index if not exists reposts_user_idx on reposts (user_id, id desc);

create index if not exists posts_top_level_idx on posts (id) where reply_to_id is null;

create index if not exists articles_user_idx on articles (user_id, state, modified_at desc);

create index if not exists post_mentions_user_idx on post_mentions (user_id);

create index if not exists posts_quotes_idx on posts (quote_id, user_id) where quote_id is not null;

create index if not exists blocks_blocked_idx on blocks (blocked_id);

create unique index if not exists muted_keywords_user_word_idx on muted_keywords (user_id, lower(keyword));

create index if not exists users_suspended_idx on users (id) where status = 'suspended';

create index if not exists audit_log_created_idx on audit_log (created_at desc);

create unique index if not exists affiliations_user_idx on affiliations (user_id);

create index if not exists reports_status_idx on reports (status, created_at desc);

create index if not exists username_changes_user_idx on username_changes (user_id, changed_at desc);

create index if not exists chat_members_user_idx on chat_members (user_id);

create index if not exists chat_events_conversation_idx on chat_events (conversation_id, kind, seq desc);

create index if not exists chat_events_conversation_seq_idx on chat_events (conversation_id, seq desc);

create index if not exists chat_events_sender_kind_idx on chat_events (conversation_id, kind, sender_id, seq desc);

create index if not exists chat_events_sender_idx on chat_events (sender_id);

create index if not exists chat_events_created_idx on chat_events (created_at);

create index if not exists chat_conversations_creator_idx on chat_conversations (creator_id);

create index if not exists chat_trust_target_idx on chat_trust (trusted_id);

create index if not exists chat_hidden_events_seq_idx on chat_hidden_events (seq);

create index if not exists chat_uploads_uploader_idx on chat_uploads (uploader_id);

create index if not exists chat_events_audience_idx on chat_events (audience_id);

create index if not exists users_org_badge_idx on users(org_badge_id);

create index if not exists users_status_until_idx on users(status_until) where status_until is not null;

create index if not exists lists_owner_idx on lists (owner_id);

create index if not exists list_members_user_idx on list_members (user_id);

create index if not exists list_subscribers_user_idx on list_subscribers (user_id);

create unique index if not exists communities_name_key on communities (lower(name));

create index if not exists community_members_user_idx on community_members (user_id);

create index if not exists community_rules_community_idx on community_rules (community_id, position);

create index if not exists posts_community_idx on posts (community_id, id desc) where community_id is not null;

create index if not exists scheduled_posts_due_idx on scheduled_posts (execute_at) where kind = 'scheduled';

create index if not exists scheduled_posts_user_idx on scheduled_posts (user_id, kind);

create index if not exists post_versions_post_idx on post_versions (post_id, seq);

create index if not exists follow_requests_target_idx on follow_requests (target_id, created_at desc);

create index if not exists bookmark_folders_user_idx on bookmark_folders (user_id, created_at);

create unique index if not exists topics_name_key on topics (lower(name));

create index if not exists topic_follows_topic_idx on topic_follows (topic_id);

create index if not exists topic_not_interested_topic_idx on topic_not_interested (topic_id);

create index if not exists post_notifications_target_idx on post_notifications (target_id);

create index if not exists contacts_user_idx on contacts (user_id, id);

create index if not exists login_events_user_idx on login_events (user_id, created_at desc);

create index if not exists mail_log_created_idx on mail_log (created_at desc);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

create index if not exists email_confirmations_user_idx on email_confirmations (user_id);

create index if not exists error_log_last_idx on error_log (last_at desc);

create index if not exists affiliation_requests_user_idx on affiliation_requests (user_id);

create index if not exists unfollows_followee_idx on unfollows (followee_id, created_at);

create index if not exists post_views_created_idx on post_views (created_at);

create index if not exists stickers_pack_idx on stickers (pack_id, position);

create index if not exists api_tokens_user_idx on api_tokens (user_id);

create index if not exists delegation_members_member_idx on delegation_members (member_id);

create index if not exists login_events_ip_idx on login_events (ip, created_at desc);

create index if not exists media_user_post_idx on media (user_id, post_id) where post_id is not null;

create view if not exists feed_items as
	select p.id as item_id, p.id as post_id, null as reposter_id, p.user_id as author_id,
		p.reply_to_id is not null as is_reply, p.created_at
	from posts p
	union all
	select r.id, r.post_id, r.user_id, r.user_id, false, r.created_at
	from reposts r;

-- SQLite uses row triggers for the counters maintained by statement triggers in schema.sql.
create trigger if not exists user_stats_posts_insert after insert on posts begin
	insert into user_stats (user_id, posts) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set posts = posts + excluded.posts;
	insert into user_stats (user_id, articles) select new.user_id, (new.article_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set articles = articles + excluded.articles;
end;

create trigger if not exists user_stats_posts_delete after delete on posts begin
	update user_stats set posts = posts - (1) where user_id = old.user_id;
	update user_stats set articles = articles - (old.article_id is not null) where user_id = old.user_id;
end;

create trigger if not exists user_stats_likes_insert after insert on likes begin
	insert into user_stats (user_id, likes) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set likes = likes + excluded.likes;
end;

create trigger if not exists user_stats_likes_delete after delete on likes begin
	update user_stats set likes = likes - (1) where user_id = old.user_id;
end;

create trigger if not exists user_stats_highlights_insert after insert on highlights begin
	insert into user_stats (user_id, highlights) select new.user_id, (1) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set highlights = highlights + excluded.highlights;
end;

create trigger if not exists user_stats_highlights_delete after delete on highlights begin
	update user_stats set highlights = highlights - (1) where user_id = old.user_id;
end;

create trigger if not exists user_stats_follows_insert after insert on follows begin
	insert into user_stats (user_id, followers) select new.followee_id, (1) where exists (select 1 from users where id = new.followee_id) on conflict(user_id) do update set followers = followers + excluded.followers;
	insert into user_stats (user_id, following) select new.follower_id, (1) where exists (select 1 from users where id = new.follower_id) on conflict(user_id) do update set following = following + excluded.following;
end;

create trigger if not exists user_stats_follows_delete after delete on follows begin
	update user_stats set followers = followers - (1) where user_id = old.followee_id;
	update user_stats set following = following - (1) where user_id = old.follower_id;
end;

create trigger if not exists user_stats_media_insert after insert on media begin
	insert into user_stats(user_id, media_posts) select new.user_id, (select count(distinct post_id) from media where user_id = new.user_id and post_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;

create trigger if not exists user_stats_media_delete after delete on media begin
	insert into user_stats(user_id, media_posts) select old.user_id, (select count(distinct post_id) from media where user_id = old.user_id and post_id is not null) where exists (select 1 from users where id = old.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;

create trigger if not exists user_stats_media_update after update on media begin
	insert into user_stats(user_id, media_posts) select old.user_id, (select count(distinct post_id) from media where user_id = old.user_id and post_id is not null) where exists (select 1 from users where id = old.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
	insert into user_stats(user_id, media_posts) select new.user_id, (select count(distinct post_id) from media where user_id = new.user_id and post_id is not null) where exists (select 1 from users where id = new.user_id) on conflict(user_id) do update set media_posts = excluded.media_posts;
end;
