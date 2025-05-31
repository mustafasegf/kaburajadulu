CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`channel_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stage_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`unique_user_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stage_users` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`join_time` integer NOT NULL,
	`leave_time` integer,
	`total_time_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `stage_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stage_user_index` ON `stage_users` (`user_id`,`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stage_users_user_id_session_id_unique` ON `stage_users` (`user_id`,`session_id`);