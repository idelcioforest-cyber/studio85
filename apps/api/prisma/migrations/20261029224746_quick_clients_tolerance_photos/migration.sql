-- AlterTable
ALTER TABLE `media_assets` ADD COLUMN `appointment_id` VARCHAR(191) NULL,
    MODIFY `work_order_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `schedule_shifts` ADD COLUMN `overbook_tolerance` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `profile_incomplete` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `email` VARCHAR(150) NULL,
    MODIFY `phone` VARCHAR(20) NULL,
    MODIFY `cpf_encrypted` TEXT NULL,
    MODIFY `cpf_lookup_hash` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `media_assets_appointment_id_idx` ON `media_assets`(`appointment_id`);

-- AddForeignKey
ALTER TABLE `media_assets` ADD CONSTRAINT `media_assets_appointment_id_fkey` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
