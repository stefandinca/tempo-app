-- Migration: Add VB-MAPP evaluations table
-- VB-MAPP (Verbal Behavior Milestones Assessment and Placement Program)
-- Stores evaluations with 0-5 scale scoring for Milestones, Barriers, and Transition assessments

CREATE TABLE IF NOT EXISTS `vbmapp_evaluations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_id` varchar(255) NOT NULL,
  `eval_date` date NOT NULL,
  `milestones_scores_json` TEXT DEFAULT NULL COMMENT 'JSON object with level/area/item scores (0-5 scale)',
  `barriers_scores_json` TEXT DEFAULT NULL COMMENT 'JSON array with barrier item scores (0-5 scale)',
  `transition_scores_json` TEXT DEFAULT NULL COMMENT 'JSON array with transition item scores (0-5 scale)',
  `comments` text DEFAULT NULL COMMENT 'Optional evaluation notes',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_vbmapp_eval` (`client_id`, `eval_date`),
  KEY `idx_client_date` (`client_id`, `eval_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
