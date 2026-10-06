CREATE TABLE `ai_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`user_id` integer NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_keys_hash_unique` ON `ai_keys` (`hash`);--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `key_id` integer;