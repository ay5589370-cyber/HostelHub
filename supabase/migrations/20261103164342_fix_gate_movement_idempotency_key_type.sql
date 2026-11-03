-- Existing gate_events.idempotency_key is text, while the secure movement RPC
-- accepts a UUID. Keep the established schema and explicitly cast at both
-- comparison and insert sites; do not rewrite existing audit rows.
do $fix_gate_idempotency_type$
declare
  function_definition text;
  fixed_definition text;
begin
  function_definition := pg_get_functiondef(
    'private.record_gate_movement(uuid,uuid,text,text,text,text,uuid)'::regprocedure
  );
  fixed_definition := replace(
    function_definition,
    'idempotency_key = p_idempotency_key',
    'idempotency_key = p_idempotency_key::text'
  );
  fixed_definition := replace(
    fixed_definition,
    '''accepted'',p_idempotency_key,',
    '''accepted'',p_idempotency_key::text,'
  );
  if fixed_definition = function_definition then
    raise exception 'Expected idempotency key comparison was not found in record_gate_movement';
  end if;
  execute fixed_definition;
end;
$fix_gate_idempotency_type$;
