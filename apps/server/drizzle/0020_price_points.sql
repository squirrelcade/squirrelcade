CREATE TABLE `price_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` text NOT NULL,
	`include_string` text NOT NULL,
	`value_cents` integer NOT NULL,
	`recorded_at` text NOT NULL,
	`import_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_points_product_idx` ON `price_points` (`product_id`,`include_string`);