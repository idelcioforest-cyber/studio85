-- CreateTable
CREATE TABLE `user_activity_days` (
    `user_id` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_activity_days_day_idx`(`day`),
    PRIMARY KEY (`user_id`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_events` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `session_id` VARCHAR(40) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `site_events_type_day_idx`(`type`, `day`),
    UNIQUE INDEX `site_events_session_id_type_day_key`(`session_id`, `type`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_activity_days` ADD CONSTRAINT `user_activity_days_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Papel do dono da plataforma (indicadores de uso)
INSERT INTO `roles` (`id`, `name`, `description`, `created_at`)
SELECT UUID(), 'SUPER_ADMIN', 'Dono da plataforma: indicadores de uso', CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `roles` WHERE `name` = 'SUPER_ADMIN');

-- Política de Privacidade: informa a medição anônima de uso
UPDATE `legal_documents`
SET `content_markdown` = REPLACE(
      `content_markdown`,
      'preferência de tema claro ou escuro. Não usamos cookies de publicidade.',
      'preferência de tema claro ou escuro. Para melhorar o app, contamos de forma anônima quantas pessoas abrem o site e o agendamento: o navegador gera um código aleatório que vale só enquanto a aba está aberta e não identifica você. Não usamos cookies de publicidade.'
    ),
    `version` = '1.1'
WHERE `slug` = 'privacy_policy' AND `content_markdown` LIKE '%preferência de tema claro ou escuro. Não usamos cookies de publicidade.%';
