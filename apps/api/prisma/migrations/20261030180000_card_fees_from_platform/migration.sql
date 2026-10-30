-- As taxas do cartão passam a ser da plataforma (PAGARME_FEE_CARD_PERCENTS); o dono só escolhe as parcelas.
-- Todos começam à vista (1x), como já estava; as taxas digitadas no painel deixam de existir.
ALTER TABLE `business_settings` DROP COLUMN `online_fees_json`,
    ADD COLUMN `max_installments` INTEGER NOT NULL DEFAULT 1;
