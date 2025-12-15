-- Migration for nutrition_items
--
-- Creates a table for storing custom nutrition schedules. Each row
-- represents a nutrient along with metadata and scheduling details.

CREATE TABLE IF NOT EXISTS nutrition_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nutrient text NOT NULL,
    source text,
    purpose text,
    mode text NOT NULL CHECK (mode IN ('weekday', 'decan')),
    days_of_week int[],
    decan_days int[],
    repeat boolean NOT NULL DEFAULT true,
    time_h int NOT NULL,
    time_m int NOT NULL,
    alert_offset_minutes int,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_valid_mode_array CHECK (
      (mode = 'weekday' AND days_of_week IS NOT NULL AND decan_days IS NULL)
      OR
      (mode = 'decan' AND decan_days IS NOT NULL AND days_of_week IS NULL)
    ),
    CONSTRAINT ck_time_h CHECK (time_h >= 0 AND time_h <= 23),
    CONSTRAINT ck_time_m CHECK (time_m >= 0 AND time_m <= 59),
    CONSTRAINT ck_dow_range CHECK (
      days_of_week IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(days_of_week) d WHERE d < 1 OR d > 7
      )
    ),
    CONSTRAINT ck_decan_range CHECK (
      decan_days IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(decan_days) d WHERE d < 1 OR d > 10
      )
    )
);

ALTER TABLE nutrition_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own nutrition items"
  ON nutrition_items
  FOR ALL
  USING (auth.uid() = user_id);

-- Trigger to maintain updated_at
CREATE OR REPLACE FUNCTION update_nutrition_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nutrition_items_updated_at ON nutrition_items;
CREATE TRIGGER nutrition_items_updated_at
  BEFORE UPDATE ON nutrition_items
  FOR EACH ROW EXECUTE FUNCTION update_nutrition_updated_at();

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_nutrition_items_user_id ON nutrition_items(user_id);



