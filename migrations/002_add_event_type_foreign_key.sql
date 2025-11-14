-- Migration: Add foreign key constraint to events.type
-- This ensures data integrity by preventing events from referencing non-existent event types

-- Step 1: Check for orphaned events (events with types that don't exist in event_types)
-- Uncomment the following query to see if there are any orphaned events before running the migration:
-- SELECT e.id, e.name, e.type
-- FROM events e
-- LEFT JOIN event_types et ON e.type = et.id
-- WHERE e.type IS NOT NULL AND et.id IS NULL;

-- Step 2: Clean up orphaned events (if any exist)
-- Option A: Set orphaned events to a default type (e.g., 'therapy')
-- UPDATE events e
-- LEFT JOIN event_types et ON e.type = et.id
-- SET e.type = 'therapy'
-- WHERE e.type IS NOT NULL AND et.id IS NULL;

-- Option B: Delete orphaned events (use with caution!)
-- DELETE e FROM events e
-- LEFT JOIN event_types et ON e.type = et.id
-- WHERE e.type IS NOT NULL AND et.id IS NULL;

-- Step 3: Fix charset/collation mismatch
-- The events.type column must match event_types.id exactly for the foreign key to work
-- event_types.id uses utf8mb4 with utf8mb4_unicode_ci collation
ALTER TABLE `events`
  MODIFY COLUMN `type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Step 4: Add the foreign key constraint
-- ON DELETE RESTRICT prevents deletion of event types that are in use
-- ON UPDATE CASCADE automatically updates event.type if event_types.id changes
ALTER TABLE `events`
  ADD CONSTRAINT `fk_events_type`
  FOREIGN KEY (`type`)
  REFERENCES `event_types` (`id`)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- Step 5: Add an index on the type column for better query performance
-- (This is automatically created by the foreign key, but making it explicit for clarity)
-- ALTER TABLE `events` ADD INDEX `idx_events_type` (`type`);
