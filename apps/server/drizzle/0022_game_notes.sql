CREATE TABLE `game_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`note` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_notes_key_idx` ON `game_notes` (`platform_id`,`title_key`);