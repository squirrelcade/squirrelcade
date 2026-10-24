CREATE TABLE `game_videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_key` text NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`channel` text,
	`published_at` text,
	`source` text NOT NULL,
	`era` text,
	`kind` text,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_videos_idx` ON `game_videos` (`title_key`,`video_id`);--> statement-breakpoint
CREATE TABLE `video_lookups` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`at` text NOT NULL
);
