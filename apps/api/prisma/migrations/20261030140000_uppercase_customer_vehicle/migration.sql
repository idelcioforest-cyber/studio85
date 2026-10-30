-- Cadastros de cliente e veículo passam a ser gravados em maiúsculas: padroniza o que já existe.
-- Nomes da equipe (quem tem outro papel além de CLIENT) ficam como estão.
UPDATE `vehicles` SET `make` = UPPER(`make`), `model` = UPPER(`model`), `color` = UPPER(`color`);

UPDATE `addresses`
SET `street` = UPPER(`street`), `complement` = UPPER(`complement`), `neighborhood` = UPPER(`neighborhood`),
    `city` = UPPER(`city`), `reference_point` = UPPER(`reference_point`);

UPDATE `users` u
SET u.`name` = UPPER(u.`name`)
WHERE EXISTS (SELECT 1 FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id` WHERE ur.`user_id` = u.`id` AND r.`name` = 'CLIENT')
  AND NOT EXISTS (SELECT 1 FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id` WHERE ur.`user_id` = u.`id` AND r.`name` <> 'CLIENT');

UPDATE `appointments` SET `customer_name` = UPPER(`customer_name`), `vehicle_label` = UPPER(`vehicle_label`);
