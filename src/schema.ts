// Authoritative schema for both databases. Routine edits generate versioned upgrades.
import { column, type Schema } from "./db/schema-types";
import { schemaEffects } from "./db/schema-effects";
export const schema: Schema = {
	tables: {
		users: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				screen_name: column("text", { notNull: true }),
				name: column("text", { notNull: true }),
				password_hash: column("text", { notNull: true }),
				bio: column("text", { notNull: true, default: "''" }),
				location: column("text", { notNull: true, default: "''" }),
				avatar_url: column("text"),
				banner_url: column("text"),
				verified_type: column("text", { check: "verified_type in ('blue', 'business', 'government', 'government_individual')" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				education_flags: column("json", { notNull: true, default: "'{}'" }),
				preferences: column("json", { notNull: true, default: "'{}'" }),
				country: column("text"),
				status_until: column("timestamp"),
				deactivated_at: column("timestamp"),
				language: column("text", { notNull: true, default: "'en'" }),
				email: column("text"),
				totp_enabled: column("boolean", { notNull: true, default: "false" }),
				totp_secret: column("text"),
				totp_pending: column("text"),
				totp_backup: column("json", { notNull: true, default: "'[]'" }),
				email_settings: column("json", { notNull: true, default: "'{}'" }),
				status_restore: column("text"),
				notes_writer: column("boolean", { notNull: true, default: "false" }),
				notes_alias: column("text", {
					notNull: true,
					default: {
						postgres: "'Contributor-' || substr(replace(cast(gen_random_uuid() as text), '-', ''), 1, 12)",
						sqlite: "'Contributor-' || substr(replace(gen_random_uuid(), '-', ''), 1, 12)",
					},
				}),
				website: column("text", { notNull: true, default: "''" }),
				pinned_post_id: column("bigint", { references: { table: "posts", column: "id", onDelete: "set null" } }),
				notifications_seen_at: column("timestamp", { notNull: true, default: "now()" }),
				invite_code: column("text", { references: { table: "invites", column: "code", onDelete: "set null" } }),
				flag: column("text"),
				role: column("text", { check: "role in ('admin', 'moderator', 'support')" }),
				status: column("text", { notNull: true, check: "status in ('active', 'restricted', 'limited', 'suspended')", default: "'active'" }),
				last_seen_at: column("timestamp"),
				verified_at: column("timestamp"),
				org_badge_id: column("bigint", { references: { table: "custom_badges", column: "id", onDelete: "set null" } }),
				protected: column("boolean", { notNull: true, default: "false" }),
				signup_source: column("text"),
				signup_country: column("text"),
				based_in_override: column("text"),
				activity_mailed_at: column("timestamp"),
				messages_mailed_at: column("timestamp"),
				activity_checked_at: column("timestamp"),
				messages_checked_at: column("timestamp"),
				translator: column("text", { check: "translator in ('translator', 'moderator', 'approver')" }),
				email_verified: column("boolean", { notNull: true, default: "false" }),
				count_overrides: column("json"),
				delegation_invites: column("text", { notNull: true, check: "delegation_invites in ('Nobody', 'Everyone', 'OnlyFollowing')", default: "'Everyone'" }),
				automated_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				parody_label: column("text", { notNull: true, check: "parody_label in ('None', 'Parody', 'Commentary', 'Fan')", default: "'None'" }),
				parody_label_at: column("timestamp"),
				label_id: column("bigint", { references: { table: "account_labels", column: "id", onDelete: "set null" } }),
				role_granted_by: column("bigint"),
				never_sensitive: column("boolean", { notNull: true, default: "false" }),
				remote_badges: column("json"),
				remote_counts: column("json"),
				instance: column("text"),
				remote_id: column("bigint"),
				instance_blocked: column("boolean", { notNull: true, default: "false" }),
				decoration: column("json"),
				decor: column("json"),
			},
		},
		sessions: {
			columns: {
				token: column("text", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				csrf: column("text", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				id: column("uuid", { notNull: true, default: "gen_random_uuid()" }),
				last_seen_at: column("timestamp", { notNull: true, default: "now()" }),
				user_agent: column("text"),
				ip: column("text"),
				expires_at: column("timestamp"),
				superadmin: column("boolean", { notNull: true, default: "false" }),
			},
		},
		posts: {
			columns: {
				received_at: column("timestamp", { notNull: true, default: "now()" }),
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				text: column("text", { notNull: true }),
				reply_to_id: column("bigint"),
				conversation_id: column("bigint", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				reply_to_user_id: column("bigint"),
				reply_policy: column("text"),
				hidden: column("boolean", { notNull: true, default: "false" }),
				sensitive: column("boolean", { notNull: true, default: "false" }),
				source: column("text", { notNull: true, default: "'Xitter for Web'" }),
				quote_id: column("bigint", { references: { table: "posts", column: "id", onDelete: "set null" } }),
				article_id: column("bigint", { references: { table: "articles", column: "id", onDelete: "set null" } }),
				community_id: column("bigint", { references: { table: "communities", column: "id", onDelete: "set null" } }),
				poll_id: column("bigint", { references: { table: "polls", column: "id", onDelete: "set null" } }),
				place_id: column("text"),
				edit_count: column("integer", { notNull: true, default: "0" }),
				edited_at: column("timestamp"),
				pinned_reply_id: column("bigint", { references: { table: "posts", column: "id", onDelete: "set null" } }),
				notice: column("json"),
				count_overrides: column("json"),
				reply_hidden_at: column("timestamp"),
				remote_counts: column("json"),
			},
		},
		custom_badges: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				name: column("text", { notNull: true, check: "length(name) between 1 and 60" }),
				image: column("bytes", { notNull: true }),
				mime: column("text", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		user_badges: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				badge_id: column("bigint", { notNull: true, references: { table: "custom_badges", column: "id", onDelete: "cascade" } }),
				position: column("integer", { notNull: true, default: "0" }),
			},
			primaryKey: ["user_id", "badge_id"],
		},
		login_challenges: {
			columns: {
				token: column("uuid", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				attempts: column("integer", { notNull: true, default: "0" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		post_views: {
			columns: {
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["post_id", "user_id"],
		},
		password_resets: {
			columns: {
				token_hash: column("text", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				used: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		data_exports: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				body: column("json", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		staff_notes: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				actor_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				body: column("text", { notNull: true, check: "length(body) between 1 and 2000" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		staff_messages: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				actor_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				kind: column("text", { notNull: true, check: "kind in ('message','warning','strike')" }),
				body: column("text", { notNull: true, check: "length(body) between 1 and 2000" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				read_at: column("timestamp"),
				revoked_at: column("timestamp"),
			},
		},
		moderation_appeals: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				message_id: column("bigint", { references: { table: "staff_messages", column: "id", onDelete: "set null" } }),
				body: column("text", { notNull: true }),
				status: column("text", { notNull: true, check: "status in ('open','accepted','rejected')", default: "'open'" }),
				staff_reply: column("text"),
				reviewer_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				resolved_at: column("timestamp"),
			},
		},
		client_platforms: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				label: column("text", { notNull: true, check: "length(label) between 1 and 80" }),
				token_hash: column("text", { notNull: true, unique: true }),
				creator_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				revoked: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		community_notes: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				author_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				text: column("text", { notNull: true, check: "length(text) between 1 and 500" }),
				classification: column("text", { notNull: true, check: "classification in ('Misleading', 'NotMisleading')" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				data_v1: column("json", { notNull: true, default: "'{}'" }),
			},
			unique: [["post_id", "author_id"]],
		},
		community_note_ratings: {
			columns: {
				note_id: column("bigint", { notNull: true, references: { table: "community_notes", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				rating: column("text", { notNull: true, check: "rating in ('Helpful', 'SomewhatHelpful', 'NotHelpful')" }),
				data_v2: column("json", { notNull: true, default: "'{}'" }),
			},
			primaryKey: ["note_id", "user_id"],
		},
		community_note_requests: {
			columns: {
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				source_link: column("text"),
				suggestion: column("text"),
			},
			primaryKey: ["post_id", "user_id"],
		},
		likes: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "post_id"],
		},
		reposts: {
			columns: {
				id: column("bigint", { notNull: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "post_id"],
		},
		bookmarks: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "post_id"],
		},
		highlights: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "post_id"],
		},
		follows: {
			columns: {
				follower_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				followee_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["follower_id", "followee_id"],
			checks: ["follower_id <> followee_id"],
		},
		media: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				kind: column("text", { notNull: true }),
				mime: column("text", { notNull: true }),
				size: column("integer", { notNull: true }),
				width: column("integer", { notNull: true }),
				height: column("integer", { notNull: true }),
				post_id: column("bigint", { references: { table: "posts", column: "id", onDelete: "set null" } }),
				position: column("smallint"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				duration_ms: column("integer"),
				state: column("text", { notNull: true, default: "'ready'" }),
				alt_text: column("text"),
				sensitive_warning: column("text[]"),
				detached: column("boolean", { notNull: true, default: "false" }),
				remote_instance: column("text"),
				remote_id: column("bigint"),
			},
		},
		articles: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				title: column("text", { notNull: true, default: "''" }),
				content_state: column("json"),
				plain_text: column("text", { notNull: true, default: "''" }),
				cover_media_id: column("bigint", { references: { table: "media", column: "id", onDelete: "set null" } }),
				state: column("text", { notNull: true, default: "'Draft'" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				modified_at: column("timestamp", { notNull: true, default: "now()" }),
				first_published_at: column("timestamp"),
				hidden: column("boolean", { notNull: true, default: "false" }),
			},
		},
		post_mentions: {
			columns: {
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
			},
			primaryKey: ["post_id", "user_id"],
		},
		blocks: {
			columns: {
				blocker_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				blocked_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["blocker_id", "blocked_id"],
		},
		mutes: {
			columns: {
				muter_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				muted_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["muter_id", "muted_id"],
		},
		muted_keywords: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				keyword: column("text", { notNull: true }),
				surfaces: column("text[]", { notNull: true }),
				exclude_following: column("boolean", { notNull: true, default: "false" }),
				valid_until: column("timestamp"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		invites: {
			columns: {
				code: column("text", { notNull: true, primaryKey: true }),
				created_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				max_uses: column("integer", { notNull: true, default: "1" }),
				uses: column("integer", { notNull: true, default: "0" }),
				expires_at: column("timestamp"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				org_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				revoked: column("boolean", { notNull: true, default: "false" }),
			},
		},
		audit_log: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				actor_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				action: column("text", { notNull: true }),
				target: column("text"),
				detail: column("json"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		affiliations: {
			columns: {
				org_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				manager: column("boolean", { notNull: true, default: "false" }),
			},
			primaryKey: ["org_id", "user_id"],
		},
		settings: {
			columns: {
				key: column("text", { notNull: true, primaryKey: true }),
				value: column("json", { notNull: true }),
			},
		},
		reports: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				reporter_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				post_id: column("bigint", { references: { table: "posts", column: "id", onDelete: "set null" } }),
				user_id: column("bigint", { references: { table: "users", column: "id", onDelete: "cascade" } }),
				reason: column("text", { notNull: true }),
				details: column("text", { notNull: true, default: "''" }),
				status: column("text", { notNull: true, default: "'open'" }),
				handled_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				handled_at: column("timestamp"),
				note: column("text", { notNull: true, default: "''" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		schema_steps: {
			columns: {
				name: column("text", { notNull: true, primaryKey: true }),
				done_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		username_changes: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				old_name: column("text", { notNull: true }),
				new_name: column("text", { notNull: true }),
				changed_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		signup_sessions: {
			columns: {
				token: column("uuid", { notNull: true, primaryKey: true }),
				username: column("text", { notNull: true }),
				code: column("text", { notNull: true, default: "''" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				pending: column("json"),
				email_code_hash: column("text"),
				email_code_at: column("timestamp"),
				email_attempts: column("integer", { notNull: true, default: "0" }),
			},
		},
		chat_keys: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				version: column("bigint", { notNull: true }),
				public_key: column("text", { notNull: true }),
				signing_public_key: column("text", { notNull: true }),
				identity_public_key_signature: column("text", { notNull: true, default: "''" }),
				registration_method: column("text", { notNull: true, default: "'CustomPin'" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "version"],
		},
		chat_members: {
			columns: {
				conversation_id: column("text", { notNull: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				joined_at: column("timestamp", { notNull: true, default: "now()" }),
				accepted: column("boolean", { notNull: true, default: "true" }),
				archived: column("boolean", { notNull: true, default: "false" }),
				muted: column("boolean", { notNull: true, default: "false" }),
				deleted_before: column("bigint", { notNull: true, default: "0" }),
			},
			primaryKey: ["conversation_id", "user_id"],
		},
		chat_events: {
			columns: {
				seq: column("bigint", { notNull: true, primaryKey: true }),
				conversation_id: column("text", { notNull: true }),
				sender_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				kind: column("smallint", { notNull: true }),
				event: column("bytes", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				audience_id: column("bigint", { references: { table: "users", column: "id", onDelete: "cascade" } }),
				deleted: column("boolean", { notNull: true, default: "false" }),
			},
		},
		chat_conversations: {
			columns: {
				id: column("text", { notNull: true, primaryKey: true }),
				creator_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				metadata: column("json", { notNull: true, default: "'{}'" }),
				created: column("boolean", { notNull: true, default: "false" }),
			},
		},
		chat_trust: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				trusted_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
			},
			primaryKey: ["user_id", "trusted_id"],
		},
		chat_hidden_events: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				seq: column("bigint", { notNull: true, references: { table: "chat_events", column: "seq", onDelete: "cascade" } }),
			},
			primaryKey: ["user_id", "seq"],
		},
		chat_uploads: {
			columns: {
				hash: column("text", { notNull: true, primaryKey: true }),
				resume_id: column("bigint", { notNull: true, unique: true }),
				conversation_id: column("text", { notNull: true }),
				message_id: column("text", { notNull: true }),
				uploader_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				total_bytes: column("bigint", { notNull: true, check: "total_bytes > 0" }),
				ready: column("boolean", { notNull: true, default: "false" }),
				expires_at: column("timestamp"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		lists: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				owner_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true }),
				description: column("text", { notNull: true, default: "''" }),
				is_private: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				banner_media_id: column("bigint"),
			},
		},
		list_members: {
			columns: {
				list_id: column("bigint", { notNull: true, references: { table: "lists", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["list_id", "user_id"],
		},
		list_subscribers: {
			columns: {
				list_id: column("bigint", { notNull: true, references: { table: "lists", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["list_id", "user_id"],
		},
		list_mutes: {
			columns: {
				list_id: column("bigint", { notNull: true, references: { table: "lists", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
			},
			primaryKey: ["list_id", "user_id"],
		},
		pinned_lists: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				list_id: column("bigint", { notNull: true, references: { table: "lists", column: "id", onDelete: "cascade" } }),
				position: column("integer", { notNull: true, default: "0" }),
			},
			primaryKey: ["user_id", "list_id"],
		},
		communities: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				creator_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true }),
				description: column("text", { notNull: true, default: "''" }),
				question: column("text", { notNull: true, default: "''" }),
				join_policy: column("text", { notNull: true, default: "'Open'" }),
				invites_policy: column("text", { notNull: true, default: "'MemberInvitesAllowed'" }),
				is_nsfw: column("boolean", { notNull: true, default: "false" }),
				banner_url: column("text"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				banner_width: column("integer"),
				banner_height: column("integer"),
				topic_id: column("bigint", { references: { table: "topics", column: "id", onDelete: "set null" } }),
			},
		},
		community_members: {
			columns: {
				community_id: column("bigint", { notNull: true, references: { table: "communities", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				role: column("text", { notNull: true, check: "role in ('Member', 'Moderator', 'Admin')", default: "'Member'" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["community_id", "user_id"],
		},
		community_rules: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				community_id: column("bigint", { notNull: true, references: { table: "communities", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true }),
				description: column("text", { notNull: true, default: "''" }),
				position: column("integer", { notNull: true, default: "0" }),
			},
		},
		community_join_requests: {
			columns: {
				community_id: column("bigint", { notNull: true, references: { table: "communities", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				answer: column("text", { notNull: true, default: "''" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["community_id", "user_id"],
		},
		polls: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				choices: column("text[]", { notNull: true }),
				duration_minutes: column("integer", { notNull: true }),
				ends_at: column("timestamp"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				choice_media: column("bigint[]"),
			},
		},
		poll_votes: {
			columns: {
				poll_id: column("bigint", { notNull: true, references: { table: "polls", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				choice: column("smallint", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["poll_id", "user_id"],
		},
		scheduled_posts: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				kind: column("text", { notNull: true, check: "kind in ('scheduled', 'draft')" }),
				execute_at: column("timestamp"),
				request: column("json", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				attempts: column("integer", { notNull: true, default: "0" }),
				last_error: column("text"),
			},
		},
		post_versions: {
			columns: {
				version_id: column("bigint", { notNull: true, primaryKey: true }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				seq: column("integer", { notNull: true }),
				text: column("text", { notNull: true }),
				created_at: column("timestamp", { notNull: true }),
			},
		},
		follow_requests: {
			columns: {
				requester_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				target_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["requester_id", "target_id"],
			checks: ["requester_id <> target_id"],
		},
		bookmark_folders: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		bookmark_folder_posts: {
			columns: {
				folder_id: column("bigint", { notNull: true, references: { table: "bookmark_folders", column: "id", onDelete: "cascade" } }),
				post_id: column("bigint", { notNull: true, references: { table: "posts", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["folder_id", "post_id"],
		},
		topics: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				name: column("text", { notNull: true, check: "length(name) between 1 and 50" }),
				description: column("text", { notNull: true, default: "''" }),
				keywords: column("text[]", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		topic_follows: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				topic_id: column("bigint", { notNull: true, references: { table: "topics", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "topic_id"],
		},
		topic_not_interested: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				topic_id: column("bigint", { notNull: true, references: { table: "topics", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "topic_id"],
		},
		post_notifications: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				target_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "target_id"],
		},
		repost_mutes: {
			columns: {
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				target_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["user_id", "target_id"],
		},
		contacts: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				vcard: column("text", { notNull: true }),
				emails: column("text[]", { notNull: true, default: { postgres: "'{}'", sqlite: "'[]'" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		explore_cards: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				kind: column("text", { notNull: true, check: "kind in ('news', 'sports')" }),
				title: column("text", { notNull: true }),
				summary: column("text", { notNull: true, default: "''" }),
				category: column("text", { notNull: true, default: "''" }),
				query: column("text", { notNull: true }),
				image: column("bytes"),
				image_mime: column("text"),
				image_width: column("integer"),
				image_height: column("integer"),
				home: column("text", { notNull: true, default: "''" }),
				away: column("text", { notNull: true, default: "''" }),
				home_score: column("text", { notNull: true, default: "''" }),
				away_score: column("text", { notNull: true, default: "''" }),
				state: column("text", { check: "state in ('Scheduled', 'InProgress', 'Completed', 'Postponed', 'Cancelled')" }),
				clock: column("text", { notNull: true, default: "''" }),
				starts_at: column("timestamp"),
				ends_at: column("timestamp"),
				hidden: column("boolean", { notNull: true, default: "false" }),
				position: column("integer", { notNull: true, default: "0" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		login_events: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				ip: column("text"),
				country: column("text"),
				app: column("text", { notNull: true }),
				user_agent: column("text"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		mail_log: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				to_addr: column("text", { notNull: true }),
				kind: column("text", { notNull: true }),
				subject: column("text", { notNull: true }),
				status: column("text", { notNull: true, check: "status in ('sent', 'failed', 'skipped')" }),
				error: column("text"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		push_subscriptions: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				endpoint: column("text", { notNull: true, unique: true }),
				p256dh: column("text", { notNull: true }),
				auth: column("text", { notNull: true }),
				settings: column("json", { notNull: true, default: "'{}'" }),
				last_pushed_at: column("timestamp", { notNull: true, default: "now()" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		email_confirmations: {
			columns: {
				token_hash: column("text", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				email: column("text", { notNull: true }),
				used: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		error_log: {
			columns: {
				fingerprint: column("text", { notNull: true, primaryKey: true }),
				source: column("text", { notNull: true, check: "source in ('server', 'client', 'job')" }),
				message: column("text", { notNull: true }),
				stack: column("text"),
				path: column("text"),
				user_id: column("bigint"),
				count: column("integer", { notNull: true, default: "1" }),
				first_at: column("timestamp", { notNull: true, default: "now()" }),
				last_at: column("timestamp", { notNull: true, default: "now()" }),
				resolved: column("boolean", { notNull: true, default: "false" }),
			},
		},
		affiliation_requests: {
			columns: {
				org_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				requested_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["org_id", "user_id"],
		},
		unfollows: {
			columns: {
				follower_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				followee_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		profile_visits: {
			columns: {
				profile_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				visitor_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				day: column("date", { notNull: true, default: "current_date" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["profile_id", "visitor_id", "day"],
		},
		sticker_packs: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				name: column("text", { notNull: true, check: "length(name) between 1 and 40" }),
				position: column("integer", { notNull: true, default: "0" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		stickers: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				pack_id: column("bigint", { notNull: true, references: { table: "sticker_packs", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true, check: "length(name) <= 40", default: "''" }),
				image: column("bytes", { notNull: true }),
				mime: column("text", { notNull: true }),
				position: column("integer", { notNull: true, default: "0" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		api_tokens: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true, check: "length(name) between 1 and 40" }),
				token_hash: column("text", { notNull: true, unique: true }),
				scope: column("text", { notNull: true, check: "scope in ('read', 'write')" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				last_used_at: column("timestamp"),
				client_id: column("bigint", { references: { table: "oauth_clients", column: "id", onDelete: "cascade" } }),
				expires_at: column("timestamp"),
			},
		},
		hashflags: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				hashtag: column("text", { notNull: true }),
				starts_at: column("timestamp", { notNull: true }),
				ends_at: column("timestamp", { notNull: true }),
				like_animation: column("text"),
				emoji: column("bytes"),
				emoji_mime: column("text"),
				hashfetti: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			checks: ["ends_at > starts_at", "like_animation is not null or emoji is not null"],
		},
		delegation_members: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				owner_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				member_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				role: column("text", { notNull: true, check: "role in ('Admin', 'Contributor')" }),
				status: column("text", { notNull: true, check: "status in ('Pending', 'Accepted')", default: "'Pending'" }),
				invited_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			unique: [["owner_id", "member_id"]],
			checks: ["owner_id <> member_id"],
		},
		link_previews: {
			columns: {
				url: column("text", { notNull: true, primaryKey: true }),
				ok: column("boolean", { notNull: true }),
				title: column("text", { notNull: true, default: "''" }),
				description: column("text", { notNull: true, default: "''" }),
				site: column("text", { notNull: true, default: "''" }),
				image: column("text"),
				width: column("integer", { notNull: true, default: "0" }),
				height: column("integer", { notNull: true, default: "0" }),
				fetched_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		retired_identities: {
			columns: {
				kind: column("text", { notNull: true, check: "kind in ('handle', 'email', 'ip')" }),
				value: column("text", { notNull: true }),
				user_id: column("bigint"),
				reason: column("text", { notNull: true, default: "''" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
			primaryKey: ["kind", "value"],
		},
		account_labels: {
			columns: {
				id: column("bigint", { notNull: true, primaryKey: true }),
				text: column("text", { notNull: true, check: "length(text) between 1 and 40" }),
				badge_id: column("bigint", { references: { table: "custom_badges", column: "id", onDelete: "set null" } }),
				url: column("text"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		user_stats: {
			columns: {
				user_id: column("bigint", { notNull: true, primaryKey: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				posts: column("integer", { notNull: true, default: "0" }),
				articles: column("integer", { notNull: true, default: "0" }),
				media_posts: column("integer", { notNull: true, default: "0" }),
				likes: column("integer", { notNull: true, default: "0" }),
				highlights: column("integer", { notNull: true, default: "0" }),
				followers: column("integer", { notNull: true, default: "0" }),
				following: column("integer", { notNull: true, default: "0" }),
			},
		},
		community_note_appeals: {
			columns: {
				note_id: column("bigint", { primaryKey: true, notNull: true, references: { table: "community_notes", column: "id", onDelete: "cascade" } }),
				author_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				reason: column("text", { notNull: true, check: "length(reason) between 20 and 1000" }),
				status: column("text", { notNull: true, check: "status in ('open', 'accepted', 'rejected')", default: "'open'" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				reviewed_by: column("bigint", { references: { table: "users", column: "id", onDelete: "set null" } }),
				reviewed_at: column("timestamp"),
				resolution: column("text"),
			},
		},
		oauth_clients: {
			columns: {
				id: column("bigint", { primaryKey: true, notNull: true }),
				owner_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				name: column("text", { notNull: true, check: "length(name) between 1 and 80" }),
				redirect_uri: column("text", { notNull: true }),
				revoked: column("boolean", { notNull: true, default: "false" }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		oauth_codes: {
			columns: {
				code_hash: column("text", { primaryKey: true, notNull: true }),
				client_id: column("bigint", { notNull: true, references: { table: "oauth_clients", column: "id", onDelete: "cascade" } }),
				user_id: column("bigint", { notNull: true, references: { table: "users", column: "id", onDelete: "cascade" } }),
				redirect_uri: column("text", { notNull: true }),
				scope: column("text", { notNull: true, check: "scope in ('read', 'write')" }),
				code_challenge: column("text", { notNull: true }),
				expires_at: column("timestamp", { notNull: true }),
			},
		},
		federated_objects: {
			columns: {
				instance: column("text", { notNull: true }),
				kind: column("text", { notNull: true, check: "kind in ('user', 'post', 'media')" }),
				remote_id: column("bigint", { notNull: true }),
				local_id: column("bigint", { notNull: true }),
			},
			primaryKey: ["instance", "kind", "remote_id"],
		},
		federation_outbox: {
			columns: {
				seq: column("bigint", { identity: true, primaryKey: true, notNull: true }),
				kind: column("text", { notNull: true, check: "kind in ('user', 'post', 'like', 'repost', 'follow')" }),
				a: column("bigint", { notNull: true }),
				b: column("bigint"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		federation_peers: {
			columns: {
				instance: column("text", { primaryKey: true, notNull: true }),
				cursor: column("bigint", { notNull: true, default: "0" }),
				key: column("text", {
					check: "key is null or (length(key) = 43 and length(translate(key, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', '')) = 0)",
				}),
				last_ok_at: column("timestamp"),
				last_error: column("text"),
				last_error_at: column("timestamp"),
			},
		},
		federation_blocks: {
			columns: {
				instance: column("text", { primaryKey: true, notNull: true }),
				source: column("text", { notNull: true, check: "source in ('local', 'emergency', 'registry')" }),
				reason: column("text", { notNull: true, default: "''" }),
				by_id: column("bigint"),
				by_name: column("text"),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
				kept_local: column("json"),
			},
		},
		federation_state: {
			columns: {
				key: column("text", { primaryKey: true, notNull: true }),
				value: column("json", { notNull: true }),
				updated_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		federation_emergencies: {
			columns: {
				seq: column("bigint", { primaryKey: true, notNull: true }),
				instance: column("text", { notNull: true }),
				action: column("text", { notNull: true, check: "action in ('block', 'lift')" }),
				reason: column("text", { notNull: true, default: "''" }),
				by_name: column("text", { notNull: true }),
				issuer: column("text", { notNull: true }),
				envelope: column("json", { notNull: true }),
				created_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
		superadmin_tickets: {
			columns: {
				nonce: column("text", { primaryKey: true, notNull: true }),
				used_at: column("timestamp", { notNull: true, default: "now()" }),
			},
		},
	},
	indexes: {
		users_screen_name_key: {
			table: "users",
			expressions: ["lower(screen_name)"],
			unique: true,
		},
		posts_replies_idx: {
			table: "posts",
			expressions: ["reply_to_id", "user_id"],
		},
		posts_user_idx: {
			table: "posts",
			expressions: ["user_id", "id desc"],
		},
		posts_reply_user_idx: {
			table: "posts",
			expressions: ["reply_to_user_id", "created_at"],
			where: "reply_to_user_id is not null",
		},
		user_badges_badge_idx: {
			table: "user_badges",
			expressions: ["badge_id"],
		},
		users_email_idx: {
			table: "users",
			expressions: ["lower(email)"],
			unique: true,
		},
		sessions_id_key: {
			table: "sessions",
			expressions: ["id"],
			unique: true,
		},
		staff_notes_user_idx: {
			table: "staff_notes",
			expressions: ["user_id", "id desc"],
		},
		staff_notes_actor_idx: {
			table: "staff_notes",
			expressions: ["actor_id"],
		},
		staff_messages_user_idx: {
			table: "staff_messages",
			expressions: ["user_id", "id desc"],
		},
		staff_messages_actor_idx: {
			table: "staff_messages",
			expressions: ["actor_id"],
		},
		moderation_appeals_user_idx: {
			table: "moderation_appeals",
			expressions: ["user_id", "id desc"],
		},
		moderation_appeals_message_idx: {
			table: "moderation_appeals",
			expressions: ["message_id"],
		},
		moderation_appeals_reviewer_idx: {
			table: "moderation_appeals",
			expressions: ["reviewer_id"],
		},
		moderation_appeals_open_user_idx: {
			table: "moderation_appeals",
			expressions: ["user_id"],
			unique: true,
			where: "status='open'",
		},
		users_notes_alias_key: {
			table: "users",
			expressions: ["notes_alias"],
			unique: true,
		},
		client_platforms_creator_idx: {
			table: "client_platforms",
			expressions: ["creator_id"],
		},
		community_notes_author_idx: {
			table: "community_notes",
			expressions: ["author_id"],
		},
		community_note_ratings_user_idx: {
			table: "community_note_ratings",
			expressions: ["user_id"],
		},
		community_note_requests_user_idx: {
			table: "community_note_requests",
			expressions: ["user_id"],
		},
		likes_post_user_idx: {
			table: "likes",
			expressions: ["post_id", "user_id"],
		},
		likes_created_idx: {
			table: "likes",
			expressions: ["created_at"],
		},
		reposts_post_user_idx: {
			table: "reposts",
			expressions: ["post_id", "user_id"],
		},
		reposts_created_idx: {
			table: "reposts",
			expressions: ["created_at"],
		},
		reposts_id_idx: {
			table: "reposts",
			expressions: ["id"],
		},
		bookmarks_post_idx: {
			table: "bookmarks",
			expressions: ["post_id"],
		},
		follows_followee_created_idx: {
			table: "follows",
			expressions: ["followee_id", "created_at"],
		},
		media_post_idx: {
			table: "media",
			expressions: ["post_id", "position"],
		},
		reposts_user_idx: {
			table: "reposts",
			expressions: ["user_id", "id desc"],
		},
		posts_top_level_idx: {
			table: "posts",
			expressions: ["id"],
			where: "reply_to_id is null",
		},
		articles_user_idx: {
			table: "articles",
			expressions: ["user_id", "state", "modified_at desc"],
		},
		post_mentions_user_idx: {
			table: "post_mentions",
			expressions: ["user_id"],
		},
		posts_quotes_idx: {
			table: "posts",
			expressions: ["quote_id", "user_id"],
			where: "quote_id is not null",
		},
		blocks_blocked_idx: {
			table: "blocks",
			expressions: ["blocked_id"],
		},
		muted_keywords_user_word_idx: {
			table: "muted_keywords",
			expressions: ["user_id", "lower(keyword)"],
			unique: true,
		},
		users_suspended_idx: {
			table: "users",
			expressions: ["id"],
			where: "status = 'suspended'",
		},
		audit_log_created_idx: {
			table: "audit_log",
			expressions: ["created_at desc"],
		},
		reports_status_idx: {
			table: "reports",
			expressions: ["status", "created_at desc"],
		},
		username_changes_user_idx: {
			table: "username_changes",
			expressions: ["user_id", "changed_at desc"],
		},
		chat_members_user_idx: {
			table: "chat_members",
			expressions: ["user_id"],
		},
		chat_events_conversation_idx: {
			table: "chat_events",
			expressions: ["conversation_id", "kind", "seq desc"],
		},
		chat_events_conversation_seq_idx: {
			table: "chat_events",
			expressions: ["conversation_id", "seq desc"],
		},
		chat_events_sender_kind_idx: {
			table: "chat_events",
			expressions: ["conversation_id", "kind", "sender_id", "seq desc"],
		},
		chat_events_sender_idx: {
			table: "chat_events",
			expressions: ["sender_id"],
		},
		chat_events_created_idx: {
			table: "chat_events",
			expressions: ["created_at"],
		},
		chat_conversations_creator_idx: {
			table: "chat_conversations",
			expressions: ["creator_id"],
		},
		chat_trust_target_idx: {
			table: "chat_trust",
			expressions: ["trusted_id"],
		},
		chat_hidden_events_seq_idx: {
			table: "chat_hidden_events",
			expressions: ["seq"],
		},
		chat_uploads_uploader_idx: {
			table: "chat_uploads",
			expressions: ["uploader_id"],
		},
		chat_events_audience_idx: {
			table: "chat_events",
			expressions: ["audience_id"],
		},
		users_org_badge_idx: {
			table: "users",
			expressions: ["org_badge_id"],
		},
		users_status_until_idx: {
			table: "users",
			expressions: ["status_until"],
			where: "status_until is not null",
		},
		lists_owner_idx: {
			table: "lists",
			expressions: ["owner_id"],
		},
		list_members_user_idx: {
			table: "list_members",
			expressions: ["user_id"],
		},
		list_subscribers_user_idx: {
			table: "list_subscribers",
			expressions: ["user_id"],
		},
		communities_name_key: {
			table: "communities",
			expressions: ["lower(name)"],
			unique: true,
		},
		community_members_user_idx: {
			table: "community_members",
			expressions: ["user_id"],
		},
		community_rules_community_idx: {
			table: "community_rules",
			expressions: ["community_id", "position"],
		},
		posts_community_idx: {
			table: "posts",
			expressions: ["community_id", "id desc"],
			where: "community_id is not null",
		},
		scheduled_posts_due_idx: {
			table: "scheduled_posts",
			expressions: ["execute_at"],
			where: "kind = 'scheduled'",
		},
		scheduled_posts_user_idx: {
			table: "scheduled_posts",
			expressions: ["user_id", "kind"],
		},
		post_versions_post_idx: {
			table: "post_versions",
			expressions: ["post_id", "seq"],
		},
		follow_requests_target_idx: {
			table: "follow_requests",
			expressions: ["target_id", "created_at desc"],
		},
		bookmark_folders_user_idx: {
			table: "bookmark_folders",
			expressions: ["user_id", "created_at"],
		},
		topics_name_key: {
			table: "topics",
			expressions: ["lower(name)"],
			unique: true,
		},
		topic_follows_topic_idx: {
			table: "topic_follows",
			expressions: ["topic_id"],
		},
		topic_not_interested_topic_idx: {
			table: "topic_not_interested",
			expressions: ["topic_id"],
		},
		post_notifications_target_idx: {
			table: "post_notifications",
			expressions: ["target_id"],
		},
		contacts_user_idx: {
			table: "contacts",
			expressions: ["user_id", "id"],
		},
		login_events_user_idx: {
			table: "login_events",
			expressions: ["user_id", "created_at desc"],
		},
		mail_log_created_idx: {
			table: "mail_log",
			expressions: ["created_at desc"],
		},
		push_subscriptions_user_idx: {
			table: "push_subscriptions",
			expressions: ["user_id"],
		},
		email_confirmations_user_idx: {
			table: "email_confirmations",
			expressions: ["user_id"],
		},
		error_log_last_idx: {
			table: "error_log",
			expressions: ["last_at desc"],
		},
		affiliation_requests_user_idx: {
			table: "affiliation_requests",
			expressions: ["user_id"],
		},
		unfollows_followee_idx: {
			table: "unfollows",
			expressions: ["followee_id", "created_at"],
		},
		post_views_created_idx: {
			table: "post_views",
			expressions: ["created_at"],
		},
		stickers_pack_idx: {
			table: "stickers",
			expressions: ["pack_id", "position"],
		},
		api_tokens_user_idx: {
			table: "api_tokens",
			expressions: ["user_id"],
		},
		delegation_members_member_idx: {
			table: "delegation_members",
			expressions: ["member_id"],
		},
		login_events_ip_idx: {
			table: "login_events",
			expressions: ["ip", "created_at desc"],
		},
		media_user_post_idx: {
			table: "media",
			expressions: ["user_id", "post_id"],
			where: "post_id is not null",
		},
		posts_created_idx: {
			table: "posts",
			expressions: ["created_at"],
		},
		community_note_appeals_open_idx: {
			table: "community_note_appeals",
			expressions: ["created_at"],
			where: "status = 'open'",
		},
		media_user_idx: {
			table: "media",
			expressions: ["user_id", "id"],
		},
		affiliations_user_created_idx: {
			table: "affiliations",
			expressions: ["user_id", "created_at"],
		},
		polls_user_idx: {
			table: "polls",
			expressions: ["user_id", "id"],
		},
		poll_votes_user_idx: {
			table: "poll_votes",
			expressions: ["user_id", "created_at", "poll_id"],
		},
		posts_poll_idx: {
			table: "posts",
			expressions: ["poll_id"],
			where: "poll_id is not null",
		},
		bookmark_folder_posts_page_idx: {
			table: "bookmark_folder_posts",
			expressions: ["folder_id", "created_at desc", "post_id desc"],
		},
		oauth_clients_owner_idx: {
			table: "oauth_clients",
			expressions: ["owner_id"],
		},
		oauth_codes_expires_idx: {
			table: "oauth_codes",
			expressions: ["expires_at"],
		},
		api_tokens_client_idx: {
			table: "api_tokens",
			expressions: ["client_id", "user_id"],
			where: "client_id is not null",
		},
		posts_hidden_replies_idx: {
			table: "posts",
			expressions: ["conversation_id"],
			where: "reply_hidden_at is not null",
		},
		users_remote_idx: {
			table: "users",
			expressions: ["instance", "remote_id"],
			unique: true,
			where: "instance is not null",
		},
		federated_objects_local_idx: {
			table: "federated_objects",
			expressions: ["kind", "local_id"],
			unique: true,
		},
		federation_outbox_created_idx: {
			table: "federation_outbox",
			expressions: ["created_at"],
		},
		users_handle_trgm_idx: {
			table: "users",
			expressions: ["screen_name gin_trgm_ops"],
			using: "gin",
			dialects: ["postgres"],
		},
		users_name_trgm_idx: {
			table: "users",
			expressions: ["name gin_trgm_ops"],
			using: "gin",
			dialects: ["postgres"],
		},
		users_bio_trgm_idx: {
			table: "users",
			expressions: ["bio gin_trgm_ops"],
			using: "gin",
			dialects: ["postgres"],
		},
		posts_text_trgm_idx: {
			table: "posts",
			expressions: ["text gin_trgm_ops"],
			using: "gin",
			dialects: ["postgres"],
		},
		polls_choice_media_idx: {
			table: "polls",
			expressions: ["choice_media"],
			using: "gin",
			dialects: ["postgres"],
			where: "choice_media is not null",
		},
	},
	views: {
		feed_items: {
			postgres:
				"select p.id as item_id, p.id as post_id, null::bigint as reposter_id, p.user_id as author_id,\n\t\tp.reply_to_id is not null as is_reply, p.created_at\n\tfrom posts p\n\tunion all\n\tselect r.id, r.post_id, r.user_id, r.user_id, false, r.created_at\n\tfrom reposts r",
			sqlite:
				"select p.id as item_id, p.id as post_id, null as reposter_id, p.user_id as author_id,\n\t\tp.reply_to_id is not null as is_reply, p.created_at\n\tfrom posts p\n\tunion all\n\tselect r.id, r.post_id, r.user_id, r.user_id, false, r.created_at\n\tfrom reposts r",
		},
	},
	effects: schemaEffects,
};
