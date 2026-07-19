CREATE TABLE `research_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symptom_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`age_band` text NOT NULL,
	`bmi_band` text NOT NULL,
	`fatigue` text,
	`weight_change` text,
	`period_pattern` text,
	`pain` text,
	`skin_hair` text,
	`model_version` text NOT NULL
);
