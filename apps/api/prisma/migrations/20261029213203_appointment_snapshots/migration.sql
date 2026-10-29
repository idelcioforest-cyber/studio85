/*
  Warnings:

  - Added the required column `customer_name` to the `appointments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vehicle_label` to the `appointments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vehicle_size` to the `appointments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `appointments` ADD COLUMN `customer_name` VARCHAR(120) NOT NULL,
    ADD COLUMN `customer_phone` VARCHAR(20) NULL,
    ADD COLUMN `source` ENUM('APP', 'WHATSAPP', 'WALK_IN') NOT NULL DEFAULT 'APP',
    ADD COLUMN `telebusca_fee_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `vehicle_label` VARCHAR(160) NOT NULL,
    ADD COLUMN `vehicle_plate` VARCHAR(10) NULL,
    ADD COLUMN `vehicle_size` ENUM('SMALL', 'MEDIUM', 'SUV', 'PICKUP', 'SPECIAL') NOT NULL,
    MODIFY `user_id` VARCHAR(191) NULL,
    MODIFY `vehicle_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `business_settings` MODIFY `company_name` VARCHAR(120) NOT NULL DEFAULT 'Studio 85';
