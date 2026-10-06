CREATE TABLE `achievement_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`platforms` text NOT NULL,
	`platform_key` text,
	`title_key` text,
	`earned` integer NOT NULL,
	`total` integer NOT NULL,
	`points_earned` integer,
	`points_total` integer,
	`progress` integer NOT NULL,
	`platinum` integer,
	`completed` integer NOT NULL,
	`last_played_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `achievement_progress_game_idx` ON `achievement_progress` (`platform_key`,`title_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `achievement_progress_source_idx` ON `achievement_progress` (`source`,`external_id`);