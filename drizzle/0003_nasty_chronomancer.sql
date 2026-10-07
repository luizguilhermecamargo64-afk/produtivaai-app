ALTER TABLE `users` DROP INDEX `users_email_idx`;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `passwordHash` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordSalt` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);