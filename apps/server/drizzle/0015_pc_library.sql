CREATE TABLE `pc_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storefront` text NOT NULL,
	`storefront_game_id` text,
	`title` text NOT NULL,
	`ownership` text NOT NULL,
	`verified_at` text,
	`notes` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pc_games` (
	`record_key` text PRIMARY KEY NOT NULL,
	`playnite_id` text NOT NULL,
	`storefront` text NOT NULL,
	`storefront_game_id` text NOT NULL,
	`name` text NOT NULL,
	`family_key` text NOT NULL,
	`platforms` text DEFAULT '[]' NOT NULL,
	`genres` text DEFAULT '[]' NOT NULL,
	`series` text DEFAULT '[]' NOT NULL,
	`completion_status` text,
	`release_year` integer,
	`added_at` text,
	`last_activity_at` text,
	`playtime_seconds` integer DEFAULT 0 NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`installed` integer DEFAULT false NOT NULL,
	`critic_score` integer,
	`community_score` integer,
	`links` text DEFAULT '[]' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pc_games_family_idx` ON `pc_games` (`family_key`);--> statement-breakpoint
CREATE TABLE `pc_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`read_at` text NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`backup_at` text,
	`fingerprint` text NOT NULL,
	`games` integer NOT NULL,
	`storefronts` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`added` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`snapshot` text
);
