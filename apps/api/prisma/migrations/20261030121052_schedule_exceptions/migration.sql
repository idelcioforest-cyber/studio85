-- CreateTable
CREATE TABLE `schedule_exceptions` (
    `id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `type` ENUM('OPEN', 'CLOSED') NOT NULL,
    `start_time` VARCHAR(5) NULL,
    `end_time` VARCHAR(5) NULL,
    `capacity` INTEGER NOT NULL DEFAULT 1,
    `note` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedule_exceptions_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
