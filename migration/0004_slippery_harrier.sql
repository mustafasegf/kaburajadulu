PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`channel_name` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`command` text NOT NULL,
	`action` text,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "channel_id", "channel_name", "server_id", "server_name", "command", "action", "user_id", "username", "name", "created_at", "updated_at") SELECT "id", "channel_id", "channel_name", "server_id", "server_name", "command", "action", "user_id", "username", "name", "created_at", "updated_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;