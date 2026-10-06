CREATE TABLE `romm_platforms` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`igdb_id` integer,
	`rom_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `romm_roms` (
	`id` integer PRIMARY KEY NOT NULL,
	`platform_id` integer NOT NULL,
	`igdb_id` integer,
	`name` text NOT NULL,
	`fs_name` text NOT NULL,
	`regions` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`playable` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `romm_roms_platform_igdb_idx` ON `romm_roms` (`platform_id`,`igdb_id`);