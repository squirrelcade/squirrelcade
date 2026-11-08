CREATE TABLE `my_wishlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`source` text DEFAULT 'suggestions' NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `my_wishlist_key_idx` ON `my_wishlist` (`platform_id`,`title_key`);