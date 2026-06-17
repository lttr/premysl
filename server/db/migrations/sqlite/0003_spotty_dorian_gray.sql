CREATE TABLE `linked_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`commit_sha` text NOT NULL,
	`last_refreshed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `linked_repositories_user_id_idx` ON `linked_repositories` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `linked_repositories_user_full_name_idx` ON `linked_repositories` (`user_id`,`full_name`);