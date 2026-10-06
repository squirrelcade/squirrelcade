CREATE TABLE `friend_files` (
	`friend_id` integer PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL,
	`made_at` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `friends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`code` text NOT NULL,
	`way` text DEFAULT 'file' NOT NULL,
	`created_at` text NOT NULL,
	`last_sent_at` text
);
