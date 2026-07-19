CREATE TABLE `daily_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_date` text NOT NULL,
	`created_at` integer NOT NULL,
	`cycle_day` integer,
	`mood` integer NOT NULL,
	`energy` integer NOT NULL,
	`bloating` integer NOT NULL,
	`pain` integer NOT NULL,
	`sleep` integer NOT NULL,
	`period_start` integer NOT NULL,
	`hot_flashes` integer,
	`skin_changes` integer,
	`hair_changes` integer,
	`model_version` text NOT NULL
);
