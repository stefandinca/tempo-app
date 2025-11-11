-- Migration: Add is_archived column to clients table
-- Date: 2025-11-11
-- Description: Adds an is_archived column to track archived vs active clients

ALTER TABLE clients
ADD COLUMN is_archived TINYINT(1) DEFAULT 0 NOT NULL
AFTER medical;

-- Update existing clients to be active (not archived) by default
UPDATE clients SET is_archived = 0 WHERE is_archived IS NULL;

-- Add index for faster filtering by archive status
CREATE INDEX idx_clients_is_archived ON clients(is_archived);
