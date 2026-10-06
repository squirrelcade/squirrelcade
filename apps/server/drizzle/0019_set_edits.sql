CREATE TABLE `set_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`platform_key` text NOT NULL,
	`title` text NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `game_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `set_edits_set_idx` ON `set_edits` (`set_id`);