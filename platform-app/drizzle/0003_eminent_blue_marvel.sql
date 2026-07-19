ALTER TABLE `daily_checkins` ADD `participant_id` text DEFAULT 'legacy_unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `data_confidence` text DEFAULT 'typical_variation' NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_checkins` ADD `quality_flags` text DEFAULT '[]' NOT NULL;