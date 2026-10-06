CREATE TABLE `game_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`details` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_details_key_idx` ON `game_details` (`platform_id`,`title_key`);--> statement-breakpoint
CREATE TABLE `owner_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`preference` text NOT NULL,
	`note` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_preferences_key_idx` ON `owner_preferences` (`platform_id`,`title_key`);