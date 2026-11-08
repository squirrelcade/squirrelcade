ALTER TABLE `friends` ADD `live_share` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `friends` ADD `live_file` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `live_written_at` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `live_link` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `their_link` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `their_link_read_at` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `their_link_checked_at` text;--> statement-breakpoint
ALTER TABLE `friends` ADD `their_link_error` text;