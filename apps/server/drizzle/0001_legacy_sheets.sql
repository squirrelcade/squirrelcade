CREATE TABLE `legacy_rows` (
	`sheet` text NOT NULL,
	`row` integer NOT NULL,
	`cells` text NOT NULL,
	FOREIGN KEY (`sheet`) REFERENCES `legacy_sheets`(`sheet`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legacy_rows_sheet_idx` ON `legacy_rows` (`sheet`,`row`);--> statement-breakpoint
CREATE TABLE `legacy_sheets` (
	`sheet` text PRIMARY KEY NOT NULL,
	`row_count` integer NOT NULL,
	`workbook` text NOT NULL,
	`imported_at` text NOT NULL
);
