-- AlterTable
ALTER TABLE `users` ADD COLUMN `password_reset_attempts` INTEGER NOT NULL DEFAULT 0;
