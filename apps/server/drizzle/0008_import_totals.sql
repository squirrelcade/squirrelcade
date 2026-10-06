ALTER TABLE `imports` ADD `game_count` integer;--> statement-breakpoint
ALTER TABLE `imports` ADD `value_cents` integer;--> statement-breakpoint
ALTER TABLE `imports` ADD `cost_cents` integer;--> statement-breakpoint
UPDATE `imports` SET
	`game_count` = (SELECT count(DISTINCT `collection_items`.`product_id`) FROM `collection_items` WHERE `collection_items`.`import_id` = `imports`.`id`),
	`value_cents` = (SELECT coalesce(sum(coalesce(`collection_items`.`value_cents`, 0) * `collection_items`.`quantity`), 0) FROM `collection_items` WHERE `collection_items`.`import_id` = `imports`.`id`),
	`cost_cents` = (SELECT coalesce(sum(coalesce(`collection_items`.`cost_cents`, 0) * `collection_items`.`quantity`), 0) FROM `collection_items` WHERE `collection_items`.`import_id` = `imports`.`id`)
WHERE `status` IN ('applied', 'pending') AND EXISTS (SELECT 1 FROM `collection_items` WHERE `collection_items`.`import_id` = `imports`.`id`);
