CREATE TABLE `added_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`file_name` text,
	`platform_key` text,
	`counts` text DEFAULT 'complete' NOT NULL,
	`games` text NOT NULL,
	`total` integer NOT NULL,
	`read_at` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
