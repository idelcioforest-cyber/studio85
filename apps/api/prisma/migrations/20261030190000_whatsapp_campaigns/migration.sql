-- CreateTable
CREATE TABLE `whatsapp_campaigns` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_campaign_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `campaign_id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'QUEUED',
    `error` VARCHAR(500) NULL,
    `queued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempted_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,

    INDEX `whatsapp_campaign_recipients_status_queued_at_idx`(`status`, `queued_at`),
    INDEX `whatsapp_campaign_recipients_attempted_at_idx`(`attempted_at`),
    UNIQUE INDEX `whatsapp_campaign_recipients_campaign_id_phone_key`(`campaign_id`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `whatsapp_campaign_recipients` ADD CONSTRAINT `whatsapp_campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `whatsapp_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

