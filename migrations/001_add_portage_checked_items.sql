-- Migration: Add portage_checked_items table to store which items were checked
-- This allows restoring checkbox states when editing evaluations

CREATE TABLE IF NOT EXISTS `portage_checked_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_id` varchar(255) NOT NULL,
  `domain` varchar(255) NOT NULL,
  `eval_date` date NOT NULL,
  `checked_items_json` TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_eval` (`client_id`, `domain`, `eval_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
