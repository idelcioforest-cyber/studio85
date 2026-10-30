-- Aviso de chegada (15 minutos antes) na mensagem de agendamento confirmado.
-- Entra logo depois da primeira linha; se o dono já tiver colocado a variável, nada muda.
UPDATE `message_templates`
SET `body` = IF(
  LOCATE(CHAR(10), `body`) > 0,
  CONCAT(SUBSTRING(`body`, 1, LOCATE(CHAR(10), `body`) - 1), CHAR(10), '{aviso_chegada}', SUBSTRING(`body`, LOCATE(CHAR(10), `body`))),
  CONCAT(`body`, CHAR(10), CHAR(10), '{aviso_chegada}')
)
WHERE `key` = 'APPOINTMENT_CONFIRMED' AND `body` NOT LIKE '%{aviso_chegada}%';

-- Termos de Uso: a regra de chegada passa a ser 15 minutos antes do horário
UPDATE `legal_documents`
SET `content_markdown` = REPLACE(
      `content_markdown`,
      '- Chegue no horário marcado. Em caso de atraso,',
      '- Chegue com pelo menos 15 minutos de antecedência do horário marcado, para a equipe receber e vistoriar o veículo. Em caso de atraso,'
    ),
    `version` = '1.1'
WHERE `slug` = 'terms_of_use' AND `content_markdown` LIKE '%- Chegue no horário marcado. Em caso de atraso,%';
