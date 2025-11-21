-- Migration: Add Task Analysis and IEP Objectives columns to VB-MAPP evaluations
-- Run this migration in phpMyAdmin ONLY if you already have the vbmapp_evaluations table
-- If you get an error that the column already exists, that's OK - it means you've already run this migration

-- Add Task Analysis column
ALTER TABLE `vbmapp_evaluations`
ADD COLUMN `task_analysis_scores_json` TEXT DEFAULT NULL COMMENT 'JSON array with task analysis item scores (0-5 scale)' AFTER `transition_scores_json`;

-- Add IEP Objectives column
ALTER TABLE `vbmapp_evaluations`
ADD COLUMN `iep_objectives_scores_json` TEXT DEFAULT NULL COMMENT 'JSON array with IEP objectives item scores (0-5 scale)' AFTER `task_analysis_scores_json`;
