CREATE TABLE `catalog_lists` (
	`platform_id` integer PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`entries` text NOT NULL,
	`games` integer NOT NULL,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `catalog_entries` ADD `evidence` text;