-- Migration: Relax constraint to allow empty schedules when enabled = false
-- This allows placeholder rows to be created before a schedule is set
--
-- Run this in Supabase SQL Editor after the initial nutrition_items table is created

ALTER TABLE nutrition_items
  DROP CONSTRAINT IF EXISTS ck_valid_mode_array;

ALTER TABLE nutrition_items
  ADD CONSTRAINT ck_valid_mode_array CHECK (
    enabled = FALSE
    OR (
      mode = 'weekday'
      AND decan_days IS NULL
      AND days_of_week IS NOT NULL
      AND array_length(days_of_week, 1) > 0
    )
    OR (
      mode = 'decan'
      AND days_of_week IS NULL
      AND decan_days IS NOT NULL
      AND array_length(decan_days, 1) > 0
    )
  );



