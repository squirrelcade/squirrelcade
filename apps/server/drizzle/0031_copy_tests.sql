CREATE TABLE `copy_tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`copy_key` text NOT NULL,
	`result` text NOT NULL,
	`note` text,
	`tested_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `copy_tests_copy_idx` ON `copy_tests` (`copy_key`,`tested_at`);--> statement-breakpoint
ALTER TABLE `copy_photos` ADD `slot` text;