CREATE TABLE `repo_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`linked_repository_id` text NOT NULL,
	`repo_full_name` text NOT NULL,
	`commit_sha` text NOT NULL,
	`file_path` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`content` text NOT NULL,
	`embedding` F32_BLOB(1024) NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_repository_id`) REFERENCES `linked_repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_chunks_user_id_idx` ON `repo_chunks` (`user_id`);--> statement-breakpoint
CREATE INDEX `repo_chunks_linked_repository_id_idx` ON `repo_chunks` (`linked_repository_id`);--> statement-breakpoint
ALTER TABLE `chats` ADD `retrieval_mode` text DEFAULT 'grep' NOT NULL;--> statement-breakpoint
CREATE VIRTUAL TABLE `repo_chunks_fts` USING fts5(content, chunk_id UNINDEXED);