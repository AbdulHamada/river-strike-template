CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`seed` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `challenges_creator_time` ON `challenges` (`creator_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_token` ON `players` (`token_hash`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`score` integer,
	`sector` integer,
	`elapsed_ms` integer,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_board` ON `runs` (`challenge_id`,`status`,`score`);--> statement-breakpoint
CREATE INDEX `runs_player_time` ON `runs` (`player_id`,`started_at`);