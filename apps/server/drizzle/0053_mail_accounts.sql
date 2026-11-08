CREATE TABLE `mail_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`password` text DEFAULT '' NOT NULL,
	`imap_host` text DEFAULT '' NOT NULL,
	`imap_port` integer DEFAULT 993 NOT NULL,
	`imap_security` text DEFAULT 'ssl' NOT NULL,
	`smtp_host` text DEFAULT '' NOT NULL,
	`smtp_port` integer DEFAULT 587 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
