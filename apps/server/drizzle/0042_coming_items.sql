CREATE TABLE `coming_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mail_ref` text NOT NULL,
	`item_index` integer NOT NULL,
	`store` text NOT NULL,
	`order_date` text,
	`order_number` text,
	`link` text,
	`listing_title` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`currency` text,
	`item_cents` integer,
	`tax_cents` integer,
	`shipping_cents` integer,
	`discount_cents` integer,
	`read_by` text NOT NULL,
	`platform_key` text,
	`title` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`copy_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coming_items_mail_idx` ON `coming_items` (`mail_ref`,`item_index`);--> statement-breakpoint
CREATE INDEX `coming_items_status_idx` ON `coming_items` (`status`);