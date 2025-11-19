-- Migration: Add subscriptions table
-- This table stores subscription information for clients

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` varchar(255) NOT NULL,
  `client_id` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_client_subscription` (`client_id`),
  KEY `idx_client_id` (`client_id`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add foreign key constraint to ensure referential integrity
ALTER TABLE `subscriptions`
  ADD CONSTRAINT `fk_subscription_client`
  FOREIGN KEY (`client_id`)
  REFERENCES `clients` (`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
