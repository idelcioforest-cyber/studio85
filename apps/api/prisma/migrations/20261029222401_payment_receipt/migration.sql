-- AlterTable
ALTER TABLE `payments` ADD COLUMN `receipt_mime_type` VARCHAR(60) NULL,
    ADD COLUMN `receipt_size_bytes` INTEGER NULL,
    ADD COLUMN `receipt_storage_key` VARCHAR(255) NULL,
    ADD COLUMN `receipt_uploaded_at` DATETIME(3) NULL;
