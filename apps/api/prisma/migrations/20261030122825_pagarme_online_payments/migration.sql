-- AlterTable
ALTER TABLE `payments` ADD COLUMN `card_brand` VARCHAR(30) NULL,
    ADD COLUMN `card_last4` VARCHAR(4) NULL,
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    ADD COLUMN `external_order_id` VARCHAR(64) NULL,
    ADD COLUMN `failure_reason` VARCHAR(255) NULL,
    ADD COLUMN `last_synced_at` DATETIME(3) NULL,
    ADD COLUMN `pix_qr_code` TEXT NULL,
    ADD COLUMN `platform_fee_cents` INTEGER NULL,
    ADD COLUMN `platform_fee_percent` INTEGER NULL,
    ADD COLUMN `recipient_cents` INTEGER NULL,
    ADD COLUMN `refunded_cents` INTEGER NOT NULL DEFAULT 0,
    MODIFY `provider` ENUM('MERCADO_PAGO', 'STONE', 'ON_DELIVERY', 'PAGARME') NOT NULL;

-- CreateTable
CREATE TABLE `payment_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(12) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `trading_name` VARCHAR(120) NULL,
    `email` VARCHAR(150) NOT NULL,
    `document_encrypted` TEXT NOT NULL,
    `document_last4` VARCHAR(4) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `birth_or_founding_date` VARCHAR(10) NOT NULL,
    `income_cents` INTEGER NOT NULL,
    `professional_occupation` VARCHAR(80) NULL,
    `street` VARCHAR(120) NOT NULL,
    `street_number` VARCHAR(20) NOT NULL,
    `complement` VARCHAR(80) NULL,
    `neighborhood` VARCHAR(80) NOT NULL,
    `city` VARCHAR(80) NOT NULL,
    `state` VARCHAR(2) NOT NULL,
    `zip_code` VARCHAR(8) NOT NULL,
    `partner_encrypted` TEXT NULL,
    `bank_holder_name` VARCHAR(120) NOT NULL,
    `bank_code` VARCHAR(3) NOT NULL,
    `branch_number` VARCHAR(5) NOT NULL,
    `branch_check_digit` VARCHAR(2) NULL,
    `account_encrypted` TEXT NOT NULL,
    `account_last4` VARCHAR(4) NOT NULL,
    `account_check_digit` VARCHAR(2) NOT NULL,
    `account_type` VARCHAR(10) NOT NULL,
    `pagarme_recipient_id` VARCHAR(64) NULL,
    `status` VARCHAR(30) NULL,
    `kyc_status` VARCHAR(30) NULL,
    `kyc_url` TEXT NULL,
    `kyc_qr_code` MEDIUMTEXT NULL,
    `kyc_expires_at` DATETIME(3) NULL,
    `fee_percent` INTEGER NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_recipients_pagarme_recipient_id_key`(`pagarme_recipient_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pagarme_webhook_events` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(64) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `resource_id` VARCHAR(64) NULL,
    `payload_json` LONGTEXT NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `processed_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pagarme_webhook_events_event_id_key`(`event_id`),
    INDEX `pagarme_webhook_events_processed_at_idx`(`processed_at`),
    INDEX `pagarme_webhook_events_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `payments_external_order_id_idx` ON `payments`(`external_order_id`);
