CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`message` text NOT NULL,
	`time` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
