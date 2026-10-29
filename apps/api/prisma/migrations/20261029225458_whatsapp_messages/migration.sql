-- AlterTable
ALTER TABLE `business_settings` ADD COLUMN `whatsapp_status` ENUM('DISCONNECTED', 'CONNECTING', 'CONNECTED') NOT NULL DEFAULT 'DISCONNECTED',
    ADD COLUMN `whatsapp_status_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `message_templates` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `body` TEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `attach_photos` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `message_templates_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_messages` (
    `id` VARCHAR(191) NOT NULL,
    `appointment_id` VARCHAR(191) NULL,
    `template_key` VARCHAR(40) NULL,
    `phone` VARCHAR(20) NOT NULL,
    `body` TEXT NOT NULL,
    `media_count` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('SENT', 'FAILED', 'SKIPPED') NOT NULL,
    `external_id` VARCHAR(120) NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsapp_messages_appointment_id_idx`(`appointment_id`),
    INDEX `whatsapp_messages_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `whatsapp_messages` ADD CONSTRAINT `whatsapp_messages_appointment_id_fkey` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
