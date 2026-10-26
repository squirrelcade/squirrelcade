CREATE TABLE `purchase_rows` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`copy_id` integer,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `copies` ADD `order_number` text;--> statement-breakpoint
ALTER TABLE `copies` ADD `asin` text;