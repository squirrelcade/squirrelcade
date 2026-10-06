CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`grant_id` integer,
	`who` text NOT NULL,
	`client` text NOT NULL,
	`tool` text NOT NULL,
	`asked` text,
	`results` integer,
	`ms` integer NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_at_idx` ON `ai_calls` (`at`);--> statement-breakpoint
CREATE INDEX `ai_calls_grant_idx` ON `ai_calls` (`grant_id`);--> statement-breakpoint
CREATE TABLE `ai_guests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_guests_email_unique` ON `ai_guests` (`email`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`secret_hash` text,
	`created_at` text NOT NULL,
	`fetched_at` text
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`grant_id` integer NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`user_id` integer,
	`guest_id` integer,
	`scope` text NOT NULL,
	`resource` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guest_id`) REFERENCES `ai_guests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grants_user_idx` ON `oauth_grants` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_guest_idx` ON `oauth_grants` (`guest_id`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`grant_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_idx` ON `oauth_tokens` (`grant_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_expires_idx` ON `oauth_tokens` (`expires_at`);--> statement-breakpoint
ALTER TABLE `copy_details` ADD `digital_claim` text;--> statement-breakpoint
ALTER TABLE `copy_details` ADD `digital_claimed_at` text;--> statement-breakpoint
ALTER TABLE `copy_details` ADD `digital_store` text;