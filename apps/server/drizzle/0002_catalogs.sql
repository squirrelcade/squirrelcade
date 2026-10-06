CREATE TABLE `catalog_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`product_id` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `catalog_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_decisions_pair_idx` ON `catalog_decisions` (`entry_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `catalog_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`format` text,
	`region` text NOT NULL,
	`target_status` text NOT NULL,
	`release_date` text,
	`notes` text,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_entries_key_idx` ON `catalog_entries` (`platform_id`,`key`);--> statement-breakpoint
CREATE TABLE `exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer,
	`title` text NOT NULL,
	`action` text NOT NULL,
	`until` text,
	`below_cents` integer,
	`reason` text,
	`active` integer NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ownership_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`owned_title` text NOT NULL,
	`satisfies_title` text NOT NULL,
	`type` text NOT NULL,
	`counts` text NOT NULL,
	`notes` text,
	`source` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
