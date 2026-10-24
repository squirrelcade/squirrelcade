CREATE TABLE `best_selling_lists` (
	`platform_key` text PRIMARY KEY NOT NULL,
	`page` text NOT NULL,
	`data` text NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_article_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_key` text NOT NULL,
	`title_key` text NOT NULL,
	`article` text,
	`found_by` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_article_links_game_idx` ON `game_article_links` (`platform_key`,`title_key`);--> statement-breakpoint
CREATE TABLE `game_articles` (
	`article` text PRIMARY KEY NOT NULL,
	`wikidata_id` text,
	`revision` integer,
	`reader_version` integer,
	`data` text,
	`wikidata` text,
	`read_at` text,
	`checked_at` text,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `catalog_entries` ADD `wiki_article` text;