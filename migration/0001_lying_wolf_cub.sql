CREATE TABLE `sticky_message` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`channel_name` text NOT NULL,
	`message` text NOT NULL,
	`last_message_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
