CREATE TABLE `barcodes` (
	`code` text PRIMARY KEY NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
