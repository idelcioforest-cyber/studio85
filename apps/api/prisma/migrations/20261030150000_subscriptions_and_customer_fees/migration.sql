-- AlterTable
ALTER TABLE `appointment_services` ADD COLUMN `covered_by_subscription` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `subscription_covered_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `subscription_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `business_settings` ADD COLUMN `online_fees_json` TEXT NULL,
    ADD COLUMN `subscriptions_enabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `subscription_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `customer_fee_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `external_invoice_id` VARCHAR(64) NULL,
    ADD COLUMN `installments` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `washes_per_month` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plan_services` (
    `plan_id` VARCHAR(191) NOT NULL,
    `service_id` VARCHAR(191) NOT NULL,

    INDEX `subscription_plan_services_service_id_idx`(`service_id`),
    PRIMARY KEY (`plan_id`, `service_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plan_prices` (
    `id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `size_category` ENUM('SMALL', 'MEDIUM', 'SUV', 'PICKUP', 'SPECIAL') NOT NULL,
    `price_cents` INTEGER NOT NULL,

    UNIQUE INDEX `subscription_plan_prices_plan_id_size_category_key`(`plan_id`, `size_category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `vehicle_id` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING_CARD', 'ACTIVE', 'CANCELED') NOT NULL DEFAULT 'PENDING_CARD',
    `plan_name_snapshot` VARCHAR(80) NOT NULL,
    `washes_per_month` INTEGER NOT NULL,
    `service_ids_json` TEXT NOT NULL,
    `size_category` ENUM('SMALL', 'MEDIUM', 'SUV', 'PICKUP', 'SPECIAL') NOT NULL,
    `price_cents` INTEGER NOT NULL,
    `customer_fee_cents` INTEGER NOT NULL DEFAULT 0,
    `charged_cents` INTEGER NOT NULL,
    `platform_fee_percent` INTEGER NOT NULL,
    `setup_token_hash` VARCHAR(64) NULL,
    `setup_token_expires_at` DATETIME(3) NULL,
    `pagarme_subscription_id` VARCHAR(64) NULL,
    `card_brand` VARCHAR(30) NULL,
    `card_last4` VARCHAR(4) NULL,
    `current_period_start` DATETIME(3) NULL,
    `current_period_end` DATETIME(3) NULL,
    `last_error` VARCHAR(255) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `canceled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_subscriptions_setup_token_hash_key`(`setup_token_hash`),
    UNIQUE INDEX `customer_subscriptions_pagarme_subscription_id_key`(`pagarme_subscription_id`),
    INDEX `customer_subscriptions_user_id_idx`(`user_id`),
    INDEX `customer_subscriptions_vehicle_id_idx`(`vehicle_id`),
    INDEX `customer_subscriptions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `appointments_subscription_id_idx` ON `appointments`(`subscription_id`);

-- CreateIndex
CREATE INDEX `orders_subscription_id_idx` ON `orders`(`subscription_id`);

-- CreateIndex
CREATE UNIQUE INDEX `payments_external_invoice_id_key` ON `payments`(`external_invoice_id`);

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `customer_subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `customer_subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_plan_services` ADD CONSTRAINT `subscription_plan_services_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_plan_services` ADD CONSTRAINT `subscription_plan_services_service_id_fkey` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_plan_prices` ADD CONSTRAINT `subscription_plan_prices_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_subscriptions` ADD CONSTRAINT `customer_subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_subscriptions` ADD CONSTRAINT `customer_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_subscriptions` ADD CONSTRAINT `customer_subscriptions_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

