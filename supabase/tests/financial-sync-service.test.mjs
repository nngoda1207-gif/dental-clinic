import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../010_atomic_invoice_payments.sql', import.meta.url), 'utf8');
const repo = readFileSync(new URL('../financial-repository.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../financial-sync-service.js', import.meta.url), 'utf8');
for (const required of [
  'create or replace function public.post_invoice_payment',
  'create or replace function public.refund_invoice_payment',
  'for update',
  'Payment exceeds the outstanding invoice balance',
  'Refund exceeds the refundable amount',
  "entry_type = 'refund'",
  'revoke insert on table public.clinic_invoice_payments',
  'grant execute on function public.post_invoice_payment',
  'grant execute on function public.refund_invoice_payment'
]) assert.ok(sql.includes(required), 'Missing SQL guard: '+required);
assert.ok(repo.includes('post_invoice_payment'));
assert.ok(repo.includes('refund_invoice_payment'));
assert.ok(service.includes('postPaymentForAssignedInvoice'));
assert.ok(service.includes('refundPaymentForAssignedInvoice'));
assert.ok(!repo.includes("from('clinic_invoice_payments').insert"));
assert.ok(!repo.includes('.update(') && !repo.includes('.delete('));
assert.ok(service.includes("new Set(['owner','manager','accountant'])"));
assert.ok(service.includes("new Set(['owner','manager','accountant','reception','readonly'])"));
assert.ok(service.includes('requireAssignedRemoteBranch'));
assert.ok(!repo.includes('localStorage') && !service.includes('localStorage'));
assert.ok(!repo.includes('service_role') && !service.includes('service_role'));
console.log('Atomic invoice payment/refund tests passed.');
