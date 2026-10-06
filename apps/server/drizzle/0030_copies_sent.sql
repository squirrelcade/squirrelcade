ALTER TABLE `copies` ADD `file_include` text;--> statement-breakpoint
ALTER TABLE `copies` ADD `listed_on` text;--> statement-breakpoint
ALTER TABLE `copies` ADD `sent_at` text;--> statement-breakpoint
UPDATE `copies` SET `file_include` = `include_string` WHERE `source` != 'gamefolio';
