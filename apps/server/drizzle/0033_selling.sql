CREATE TABLE `copy_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`copy_id` integer NOT NULL,
	`copy_key` text NOT NULL,
	`title` text NOT NULL,
	`platform_key` text,
	`platform` text,
	`completeness` text NOT NULL,
	`marketplace` text NOT NULL,
	`sold_at` text NOT NULL,
	`sold_cents` integer NOT NULL,
	`shipping_charged_cents` integer DEFAULT 0 NOT NULL,
	`fees_cents` integer DEFAULT 0 NOT NULL,
	`shipping_cost_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer,
	`estimated_cents` integer,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `copy_sales_sold_idx` ON `copy_sales` (`sold_at`);--> statement-breakpoint
ALTER TABLE `copy_tests` ADD `kind` text DEFAULT 'test' NOT NULL;