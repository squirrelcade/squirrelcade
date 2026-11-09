CREATE TABLE `audit_copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`copy_key` text NOT NULL,
	`state` text NOT NULL,
	`how` text NOT NULL,
	`shelf_id` integer,
	`at` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_copies_key_idx` ON `audit_copies` (`audit_id`,`copy_key`);--> statement-breakpoint
CREATE TABLE `audit_shelves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`platform_key` text NOT NULL,
	`photos` text DEFAULT '[]' NOT NULL,
	`reads` integer DEFAULT 0 NOT NULL,
	`not_logged` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`platforms` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `buying_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`kind` text DEFAULT 'rule' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'you' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
