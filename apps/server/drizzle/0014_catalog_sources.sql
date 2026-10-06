ALTER TABLE `catalog_builds` ADD `sources` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `catalog_builds` ADD `conflicts` text DEFAULT '[]' NOT NULL;