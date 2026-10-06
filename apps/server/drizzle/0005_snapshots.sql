CREATE TABLE `wishlist_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer,
	`created_at` text NOT NULL,
	`entries` text NOT NULL
);
