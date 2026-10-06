CREATE TABLE `ignored_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ignored_products_idx` ON `ignored_products` (`platform_id`,`product_id`);