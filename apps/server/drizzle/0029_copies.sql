CREATE TABLE `copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
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
	`quantity` integer DEFAULT 1 NOT NULL,
	`sku` text NOT NULL,
	`notes` text NOT NULL,
	`date_entered` text,
	`date_purchased` text,
	`grading_company` text NOT NULL,
	`grading_cert_id` text NOT NULL,
	`folder` text NOT NULL,
	`source` text NOT NULL,
	`own_fields` text DEFAULT '[]' NOT NULL,
	`added_at` text NOT NULL,
	`import_id` integer,
	`seen_at` text,
	`missing_since` text,
	`gone_at` text,
	`gone_reason` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copies_key_idx` ON `copies` (`key`);--> statement-breakpoint
CREATE INDEX `copies_live_idx` ON `copies` (`gone_at`,`platform_id`);--> statement-breakpoint
CREATE INDEX `copies_product_idx` ON `copies` (`product_id`);--> statement-breakpoint
ALTER TABLE `imports` ADD `format` text;