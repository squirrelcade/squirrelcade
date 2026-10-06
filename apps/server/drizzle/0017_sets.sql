CREATE TABLE `game_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`page` text,
	`collected_only` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`built_at` text,
	`message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_sets_key_unique` ON `game_sets` (`key`);--> statement-breakpoint
CREATE TABLE `set_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`title` text NOT NULL,
	`platform_key` text NOT NULL,
	`alt_titles` text,
	`notes` text,
	FOREIGN KEY (`set_id`) REFERENCES `game_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_games_set_idx` ON `set_games` (`set_id`);