CREATE TABLE `copy_details` (
	`copy_key` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`location` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`sale` text,
	`asking_cents` integer,
	`sale_note` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `copy_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`copy_key` text NOT NULL,
	`product_id` text NOT NULL,
	`caption` text,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `copy_photos_copy_idx` ON `copy_photos` (`copy_key`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`copy_key` text NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`platform_key` text,
	`lent_to` text NOT NULL,
	`lent_at` text NOT NULL,
	`due_at` text,
	`returned_at` text,
	`note` text,
	`reminded_at` text
);
--> statement-breakpoint
CREATE INDEX `loans_copy_idx` ON `loans` (`copy_key`);--> statement-breakpoint
CREATE TABLE `pc_prices` (
	`key` text PRIMARY KEY NOT NULL,
	`itad_id` text,
	`title` text NOT NULL,
	`currency` text,
	`current_cents` integer,
	`regular_cents` integer,
	`cut` integer,
	`shop` text,
	`url` text,
	`low_cents` integer,
	`missing` integer DEFAULT false NOT NULL,
	`fetched_at` text NOT NULL,
	`alerted_cents` integer
);
--> statement-breakpoint
CREATE TABLE `play_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`status` text,
	`rating` integer,
	`started_at` text,
	`finished_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_status_key_idx` ON `play_status` (`platform_id`,`title_key`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	`last_opened_at` text,
	`opens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_unique` ON `share_links` (`token`);