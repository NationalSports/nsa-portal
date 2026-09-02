-- The initial shrink guard used `IF NOT (false OR NULL)`, which evaluates to NULL in
-- PostgreSQL and therefore skips the IF body. Coalesce the authorization predicate to
-- false so a missing delete intent is rejected as intended.

DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_old text := $old$
        IF NOT (
          (p_deco_delete_intents IS NULL
           AND v_incoming_deco_count = 0
           AND coalesce((v_item->>'no_deco')::boolean, false))
          OR
          (jsonb_typeof(v_deco_delete_intent) = 'object'
           AND (v_deco_delete_intent->>'from')::int = v_existing_deco_count
           AND (v_deco_delete_intent->>'to')::int = v_incoming_deco_count)
        ) THEN
$old$;
  v_new text := $new$
        IF NOT coalesce((
          (p_deco_delete_intents IS NULL
           AND v_incoming_deco_count = 0
           AND coalesce((v_item->>'no_deco')::boolean, false))
          OR
          (jsonb_typeof(v_deco_delete_intent) = 'object'
           AND (v_deco_delete_intent->>'from')::int = v_existing_deco_count
           AND (v_deco_delete_intent->>'to')::int = v_incoming_deco_count)
        ), false) THEN
$new$;
BEGIN
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'save_estimate'
    AND pg_get_function_identity_arguments(p.oid) =
        'p_estimate jsonb, p_items jsonb, p_base_version integer, p_is_new boolean, p_deco_delete_intents jsonb';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'SAVE_ESTIMATE_GUARDED_SIGNATURE_MISSING';
  END IF;

  v_definition := pg_get_functiondef(v_oid);
  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'SAVE_ESTIMATE_NULL_GUARD_PATCH_TARGET_MISSING';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
