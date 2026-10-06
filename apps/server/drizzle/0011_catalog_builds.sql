CREATE TABLE `catalog_builds` (
	`platform_id` integer PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`built_at` text NOT NULL,
	`pages` text NOT NULL,
	`games` integer NOT NULL,
	`skipped` text NOT NULL,
	`error` text,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `catalog_entries` ADD `alt_titles` text;