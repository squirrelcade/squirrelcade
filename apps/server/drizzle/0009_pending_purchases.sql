CREATE TABLE `pending_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `catalog_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
