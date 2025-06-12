CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`command` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
