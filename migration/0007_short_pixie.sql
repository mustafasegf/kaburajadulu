PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`message` text,
	`time` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_schedule`("id", "channel_id", "channel_name", "server_id", "server_name", "message", "time", "created_at", "updated_at") SELECT "id", "channel_id", "channel_name", "server_id", "server_name", "message", "time", "created_at", "updated_at" FROM `schedule`;--> statement-breakpoint
DROP TABLE `schedule`;--> statement-breakpoint
ALTER TABLE `__new_schedule` RENAME TO `schedule`;--> statement-breakpoint
PRAGMA foreign_keys=ON;