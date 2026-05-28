-- Rhythm / Checklist core model and event allowlist extensions.
-- Safe for repeated runs: guarded by existence checks.

-- 1) cycle_fields
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cycle_fields') THEN
    CREATE TABLE public.cycle_fields (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      slug text NOT NULL,
      title text NOT NULL,
      description text,
      node_id uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
      value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      checklist_enabled boolean NOT NULL DEFAULT true,
      reminder_enabled boolean NOT NULL DEFAULT false,
      tracker_enabled boolean NOT NULL DEFAULT true,
      resolution_mode text NOT NULL DEFAULT 'checklist_primary'::text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cycle_fields_resolution_mode_check CHECK (resolution_mode = ANY (ARRAY['checklist_primary'::text, 'evidence_can_upgrade'::text, 'evidence_can_override_pending'::text]))
    );
    CREATE UNIQUE INDEX cycle_fields_user_slug_key ON public.cycle_fields(user_id, slug);
    CREATE INDEX idx_cycle_fields_user ON public.cycle_fields(user_id);
    ALTER TABLE public.cycle_fields ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cycle_fields_owner ON public.cycle_fields USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TRIGGER trg_touch_cycle_fields BEFORE UPDATE ON public.cycle_fields FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- 2) cycle_schedule_rules
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cycle_schedule_rules') THEN
    CREATE TABLE public.cycle_schedule_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      field_id uuid NOT NULL REFERENCES public.cycle_fields(id) ON DELETE CASCADE,
      title text,
      days_of_week integer[],
      all_day boolean NOT NULL DEFAULT false,
      start_time_local time without time zone,
      end_time_local time without time zone,
      reminder_offset_minutes integer,
      is_optional boolean NOT NULL DEFAULT false,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cycle_schedule_rules_days_check CHECK (days_of_week IS NULL OR days_of_week <@ ARRAY[1,2,3,4,5,6,7]),
      CONSTRAINT cycle_schedule_rules_time_check CHECK (all_day OR start_time_local IS NOT NULL)
    );
    CREATE INDEX idx_cycle_schedule_rules_user_field ON public.cycle_schedule_rules(user_id, field_id);
    CREATE INDEX idx_cycle_schedule_rules_days ON public.cycle_schedule_rules USING gin(days_of_week);
    ALTER TABLE public.cycle_schedule_rules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cycle_schedule_rules_owner ON public.cycle_schedule_rules USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TRIGGER trg_touch_cycle_schedule_rules BEFORE UPDATE ON public.cycle_schedule_rules FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- 3) todos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'todos') THEN
    CREATE TABLE public.todos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      notes text,
      due_date date,
      due_time time without time zone,
      priority smallint,
      tags text[] NOT NULL DEFAULT '{}'::text[],
      recurrence jsonb NOT NULL DEFAULT '{}'::jsonb,
      show_on_checklist boolean NOT NULL DEFAULT true,
      show_on_calendar boolean NOT NULL DEFAULT true,
      linked_field_id uuid REFERENCES public.cycle_fields(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'pending'::text,
      completed_at timestamptz,
      archived_at timestamptz,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT todos_status_check CHECK (status = ANY (ARRAY['pending'::text,'in_progress'::text,'done'::text,'skipped'::text,'archived'::text]))
    );
    CREATE INDEX idx_todos_user_due ON public.todos(user_id, due_date);
    CREATE INDEX idx_todos_status ON public.todos(status);
    ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY todos_owner ON public.todos USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TRIGGER trg_touch_todos BEFORE UPDATE ON public.todos FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- 4) checklist_items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'checklist_items') THEN
    CREATE TABLE public.checklist_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      local_date date NOT NULL,
      source text NOT NULL,
      source_key text NOT NULL,
      title text,
      status text NOT NULL DEFAULT 'pending'::text,
      is_opportunity boolean NOT NULL DEFAULT true,
      manual_lock boolean NOT NULL DEFAULT false,
      allow_evidence_upgrade boolean NOT NULL DEFAULT true,
      allow_evidence_override_pending boolean NOT NULL DEFAULT true,
      evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      field_id uuid REFERENCES public.cycle_fields(id) ON DELETE SET NULL,
      todo_id uuid REFERENCES public.todos(id) ON DELETE SET NULL,
      event_id uuid REFERENCES public.user_events(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT checklist_items_source_check CHECK (source IN ('cycle','todo','manual','event','suggestion')),
      CONSTRAINT checklist_items_status_check CHECK (status IN ('pending','done','partial','skipped','unlogged'))
    );
    CREATE UNIQUE INDEX checklist_items_user_date_source_key ON public.checklist_items(user_id, local_date, source_key);
    CREATE INDEX idx_checklist_items_user_date ON public.checklist_items(user_id, local_date);
    CREATE INDEX idx_checklist_items_status ON public.checklist_items(user_id, status);
    CREATE INDEX idx_checklist_items_field ON public.checklist_items(field_id);
    ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY checklist_items_owner ON public.checklist_items USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TRIGGER trg_touch_checklist_items BEFORE UPDATE ON public.checklist_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- 5) cycle_adjustment_suggestions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cycle_adjustment_suggestions') THEN
    CREATE TABLE public.cycle_adjustment_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending'::text,
      suggestion jsonb NOT NULL DEFAULT '{}'::jsonb,
      applied_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
      applied_from text,
      decided_at timestamptz,
      snooze_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cycle_adjustment_suggestions_status_check CHECK (status = ANY (ARRAY['pending'::text,'accepted'::text,'dismissed'::text,'snoozed'::text]))
    );
    CREATE INDEX idx_cycle_adjustment_suggestions_status ON public.cycle_adjustment_suggestions(user_id, status);
    ALTER TABLE public.cycle_adjustment_suggestions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cycle_adjustment_suggestions_owner ON public.cycle_adjustment_suggestions USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE TRIGGER trg_touch_cycle_adjustment_suggestions BEFORE UPDATE ON public.cycle_adjustment_suggestions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END$$;

-- 6) Extend user_choice_events.event_type allowlist for rhythm flows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'user_choice_events' AND c.conname = 'user_choice_events_event_type_check'
  ) THEN
    ALTER TABLE public.user_choice_events DROP CONSTRAINT user_choice_events_event_type_check;
  END IF;
  ALTER TABLE public.user_choice_events
    ADD CONSTRAINT user_choice_events_event_type_check CHECK (event_type = ANY (ARRAY[
      'node_opened'::text,
      'node_link_tapped'::text,
      'node_insight_saved'::text,
      'journal_linked_to_node'::text,
      'reflection_linked_to_node'::text,
      'node_linked_to_journal'::text,
      'node_linked_to_reflection'::text,
      'flow_completed'::text,
      'flow_skipped'::text,
      'reflection_opened'::text,
      'reflection_saved'::text,
      'reflection_rated'::text,
      'cycle_field_saved'::text,
      'checklist_completed'::text,
      'checklist_partial'::text,
      'checklist_skipped'::text,
      'todo_created'::text,
      'todo_completed'::text,
      'suggestion_accepted'::text,
      'suggestion_dismissed'::text,
      'suggestion_snoozed'::text
    ]));
END$$;
