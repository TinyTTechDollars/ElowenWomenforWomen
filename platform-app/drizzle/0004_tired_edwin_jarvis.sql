ALTER TABLE `daily_checkins` ADD `bleeding` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `symptom_signs` text DEFAULT '[]' NOT NULL;