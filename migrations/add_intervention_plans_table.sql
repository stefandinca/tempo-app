-- Migration: Add intervention_plans and intervention_plan_programs tables
-- This stores intervention plans for clients with timeline and programs

CREATE TABLE IF NOT EXISTS `intervention_plans` (
  `id` varchar(255) NOT NULL,
  `client_id` varchar(255) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_client_plan` (`client_id`),
  KEY `idx_client_id` (`client_id`),
  KEY `idx_dates` (`start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to store many-to-many relationship between intervention plans and programs
CREATE TABLE IF NOT EXISTS `intervention_plan_programs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plan_id` varchar(255) NOT NULL,
  `program_id` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_plan_program` (`plan_id`, `program_id`),
  KEY `idx_plan_id` (`plan_id`),
  KEY `idx_program_id` (`program_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add foreign key constraints
ALTER TABLE `intervention_plans`
  ADD CONSTRAINT `fk_intervention_plan_client`
  FOREIGN KEY (`client_id`)
  REFERENCES `clients` (`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE `intervention_plan_programs`
  ADD CONSTRAINT `fk_ipp_plan`
  FOREIGN KEY (`plan_id`)
  REFERENCES `intervention_plans` (`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_ipp_program`
  FOREIGN KEY (`program_id`)
  REFERENCES `programs` (`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
