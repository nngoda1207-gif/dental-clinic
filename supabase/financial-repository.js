/*
 * Financial repository — scoped invoice and payment reads, plus invoice creation.
 * Payment posting is intentionally not exposed: the current SQL has no atomic
 * payment RPC to enforce outstanding balance and invoice status in one transaction.
 * Payment rows are append-only under migration 005.
 */
import { getSupabaseClient } from './auth-adapter.js';

const INVOICE_FIELDS = 'id,clinic_id,branch_id,patient_id,invoice_no,status,currency,subtotal,discount,total,notes,issued_at,created_by,created_at';
const PAYMENT_FIELDS = 'id,clinic_id,branch_id,invoice_id,amount,method,paid_at,reference,notes,created_by,created_at';
const METHODS = new Set(['cash','card','transfer','wallet','other']);

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
function money(value, label, allowZero = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < (allowZero ? 0 : Number.EPSILON)) {
    throw new Error(label + ' must be a valid ' + (allowZero ? 'non-negative' : 'positive') + ' amount.');
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}
async function currentActor() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  const id = data.session?.user?.id;
  if (!id) throw new Error('Sign in before accessing clinic finances.');
  return id;
}
export async function listRemoteInvoices({ clinicId, branchId, patientId, limit = 500 } = {}) {
  required(clinicId, 'Clinic ID'); required(branchId, 'Branch ID');
  let query = getSupabaseClient().from('clinic_invoices').select(INVOICE_FIELDS)
    .eq('clinic_id', clinicId).eq('branch_id', branchId)
    .order('issued_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 500, 1000)));
  if (patientId) query = query.eq('patient_id', required(patientId, 'Patient ID'));
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function createRemoteInvoice({ clinicId, branchId, patientId, invoice } = {}) {
  required(clinicId, 'Clinic ID'); required(branchId, 'Branch ID'); required(patientId, 'Patient ID');
  const actorId = await currentActor();
  const value = invoice || {};
  const subtotal = money(value.subtotal, 'Subtotal');
  const discount = money(value.discount ?? 0, 'Discount');
  const total = money(value.total, 'Total');
  if (discount > subtotal) throw new Error('Discount cannot exceed subtotal.');
  if (Math.abs(total - (subtotal - discount)) > 0.01) {
    throw new Error('Invoice total must equal subtotal minus discount.');
  }
  const invoiceNo = required(value.invoice_no, 'Invoice number');
  const status = value.status || 'open';
  if (status !== 'open') throw new Error('New invoices must start with open status.');
  const currency = value.currency || 'EGP';
  if (currency !== 'EGP') throw new Error('Only EGP invoices are currently supported.');
  const payload = {
    clinic_id: clinicId, branch_id: branchId, patient_id: patientId,
    invoice_no: invoiceNo, status: 'open', currency,
    subtotal, discount, total, notes: String(value.notes || '').trim(),
    issued_at: value.issued_at ? new Date(value.issued_at).toISOString() : new Date().toISOString(),
    created_by: actorId
  };
  const { data, error } = await getSupabaseClient().from('clinic_invoices')
    .insert(payload).select(INVOICE_FIELDS).single();
  if (error) throw error;
  return data;
}
export async function listRemoteInvoicePayments({ clinicId, branchId, invoiceId, limit = 500 } = {}) {
  required(clinicId, 'Clinic ID'); required(branchId, 'Branch ID'); required(invoiceId, 'Invoice ID');
  const { data, error } = await getSupabaseClient().from('clinic_invoice_payments')
    .select(PAYMENT_FIELDS).eq('clinic_id', clinicId).eq('branch_id', branchId)
    .eq('invoice_id', invoiceId).order('paid_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 500, 1000)));
  if (error) throw error;
  return data || [];
}
export const supportedPaymentMethods = Object.freeze([...METHODS]);
