-- Dental Clinic OS: require atomic RPC for inventory ledger inserts.
-- Apply after migrations 001-007. Validate in a disposable project first.
-- Direct movement inserts can otherwise create ledger rows without changing stock.

revoke insert on table public.clinic_inventory_movements from public, anon, authenticated;

comment on table public.clinic_inventory_movements is
  'Append-only inventory ledger. Authenticated clients must create entries through post_inventory_movement() so stock balance and ledger stay atomic.';
