CREATE TABLE `ra_progress` (
	`game_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`console_name` text NOT NULL,
	`platform_key` text,
	`title_key` text,
	`num_awarded` integer NOT NULL,
	`num_awarded_hardcore` integer NOT NULL,
	`max_possible` integer NOT NULL,
	`award` text,
	`awarded_at` text,
	`last_played_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ra_progress_game_idx` ON `ra_progress` (`platform_key`,`title_key`);