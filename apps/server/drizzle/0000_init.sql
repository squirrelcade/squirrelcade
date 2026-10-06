CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`console_label` text NOT NULL,
	`platform_id` integer,
	`region` text NOT NULL,
	`value_cents` integer,
	`cost_cents` integer,
	`include_string` text NOT NULL,
	`condition_string` text NOT NULL,
	`completeness` text NOT NULL,
	`sealed` integer NOT NULL,
	`has_box` integer NOT NULL,
	`has_manual` integer NOT NULL,
	`quantity` integer NOT NULL,
	`sku` text NOT NULL,
	`notes` text NOT NULL,
	`date_entered` text,
	`date_purchased` text,
	`grading_company` text NOT NULL,
	`grading_cert_id` text NOT NULL,
	`folder` text NOT NULL,
	`line` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `collection_items_import_idx` ON `collection_items` (`import_id`,`platform_id`);--> statement-breakpoint
CREATE INDEX `collection_items_product_idx` ON `collection_items` (`import_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`file_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`applied_at` text,
	`row_count` integer NOT NULL,
	`copy_count` integer NOT NULL,
	`added_count` integer NOT NULL,
	`removed_count` integer NOT NULL,
	`changed_count` integer NOT NULL,
	`report` text NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `imports_sha_idx` ON `imports` (`file_sha256`);--> statement-breakpoint
CREATE TABLE `platform_labels` (
	`label` text PRIMARY KEY NOT NULL,
	`platform_id` integer NOT NULL,
	`region` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platforms_key_unique` ON `platforms` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `task_runs_task_idx` ON `task_runs` (`task`,`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);