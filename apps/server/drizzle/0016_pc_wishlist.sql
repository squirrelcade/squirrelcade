CREATE TABLE `pc_candidates` (
	`igdb_id` integer PRIMARY KEY NOT NULL,
	`family_key` text NOT NULL,
	`title` text NOT NULL,
	`game` text NOT NULL,
	`steam_app_id` integer,
	`steam` text,
	`steam_at` text,
	`sources` text NOT NULL,
	`found_at` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pc_candidates_family_idx` ON `pc_candidates` (`family_key`);--> statement-breakpoint
CREATE TABLE `pc_controls` (
	`family_key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`action` text,
	`until` text,
	`preference` text,
	`updated_at` text NOT NULL
);
