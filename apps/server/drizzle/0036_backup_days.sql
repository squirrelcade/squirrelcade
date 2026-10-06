-- Backups are counted in days (0.36.0): an install's interval in hours becomes whole days, rounded up. An install on the
-- old default (every 24 hours, not saved) keeps daily backups; a new install backs up weekly (the new default).
INSERT INTO `settings` (`key`, `value`, `updated_at`)
  SELECT 'tasks.backupIntervalDays', CAST((CAST(`value` AS INTEGER) + 23) / 24 AS TEXT), `updated_at` FROM `settings` WHERE `key` = 'tasks.backupIntervalHours';
--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `updated_at`)
  SELECT 'tasks.backupIntervalDays', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE EXISTS (SELECT 1 FROM `users`) AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'tasks.backupIntervalDays');
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'tasks.backupIntervalHours';
