CREATE TABLE `set_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`platform_key` text NOT NULL,
	`title_key` text NOT NULL,
	`owned_title` text NOT NULL,
	`decision` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `game_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_links_unique` ON `set_links` (`set_id`,`platform_key`,`title_key`,`owned_title`);