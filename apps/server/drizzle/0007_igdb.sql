CREATE TABLE `igdb_games` (
	`platform_id` integer NOT NULL,
	`igdb_id` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `igdb_games_idx` ON `igdb_games` (`platform_id`,`igdb_id`);--> statement-breakpoint
CREATE TABLE `igdb_syncs` (
	`platform_id` integer PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL,
	`games` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
