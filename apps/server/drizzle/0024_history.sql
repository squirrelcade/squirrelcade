CREATE TABLE `copy_groups` (
	`copy_key` text PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`platform_key` text NOT NULL,
	`title_key` text DEFAULT '' NOT NULL,
	`title` text,
	`data` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`shipped_hash` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_notes_key_idx` ON `history_notes` (`kind`,`platform_key`,`title_key`);--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`, `updated_at`) SELECT 'features.pc', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE EXISTS (SELECT 1 FROM `pc_games`) OR EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'pc.playniteFolder');--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`, `updated_at`) SELECT 'features.romm', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'sources.rommUrl');
