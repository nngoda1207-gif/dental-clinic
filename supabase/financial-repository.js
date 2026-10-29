/*
 * Financial repository: scoped invoice and ledger reads/writes.
 * Payment/refund inserts are exposed only through migration 010 security-definer RPCs.
 */
import { getSupabaseClient } from './auth-adapter.js';

const INVOICE_FIELDS = 'id,clinic_id,branch_id,patient_id,invoice_no,status,currency,subtotal,discount,total,notes,issued_at,created_by,created_at';
const PAYMENT_FIELDS = 'id,clinic_id,branch_id,invoice_id,amount,method,paid_at,reference,notes,created_by,created_at,entry_type,original_payment_id';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' is required.');
  return value.trim();
}
function positiveMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(label + ' must be positive.');
  const rounded = Math.round((number + Number.EPSILON) * 100) / 100;
  if (Math.abs(number - rounded) > 0.000001) throw new Error(label + ' supports at most two decimals.');
  return rounded;
}
function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(label + ' must be a valid date.');
  return date.toISOString();
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
  const subtotal = Number(value.subtotal);
  const discount = Number(value.discount ?? 0);
  const total = Number(value.total);
  for (const [number,label] of [[subtotal,'Subtotal'],[discount,'Discount'],[total,'Total']]) {
    if (!Number.isFinite(number) || number < 0 || Math.abs(number*100-Math.round(number*100))>0.000001) {
      throw new Error(label + ' must be non-negative with at most two decimals.');
    }
  }
  if (discount > subtotal) throw new Error('Discount cannot exceed subtotal.');
  if (Math.abs(total - (subtotal - discount)) > 0.01) throw new Error('Invoice total must equal subtotal minus discount.');
  const invoiceNo = required(value.invoice_no, 'Invoice number');
  if (value.status && value.status !== 'open') throw new Error('New invoices must start with open status.');
  const currency = value.currency || 'EGP';
  if (currency !== 'EGP') throw new Error('Only EGP invoices are currently supported.');
  const payload = {
    clinic_id: clinicId, branch_id: branchId, patient_id: patientId,
    invoice_no: invoiceNo, status: 'open', currency,
    subtotal, discount, total, notes: String(value.notes || '').trim(),
    issued_at: optionalDate(value.issued_at, 'Invoice date') || new Date().toISOString(),
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
export async function postRemoteInvoicePayment({ invoiceId, amount, method = 'cash', reference = '', notes = '', paidAt } = {}) {
  required(invoiceId, 'Invoice ID');
  const actorId = await currentActor();
  const payload = {
    p_invoice_id: invoiceId, p_amount: positiveMoney(amount, 'Payment amount'),
    p_method: method, p_reference: String(reference || '').trim(),
    p_notes: String(notes || '').trim(), p_paid_at: optionalDate(paidAt, 'Payment date') || new Date().toISOString()
  };
  const { data, error } = await getSupabaseClient().rpc('post_invoice_payment', payload);
  if (error) throw error;
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || entry.created_by !== actorId || entry.entry_type !== 'payment') {
    throw new Error('Payment actor/type verification failed.');
  }
  return entry;
}
export async function refundRemoteInvoicePayment({ originalPaymentId, amount, reference = '', notes = '', paidAt } = {}) {
  required(originalPaymentId, 'Original payment ID');
  const actorId = await currentActor();
  const payload = {
    p_original_payment_id: originalPaymentId, p_amount: positiveMoney(amount, 'Refund amount'),
    p_reference: String(reference || '').trim(), p_notes: String(notes || '').trim(),
    p_paid_at: optionalDate(paidAt, 'Refund date') || new Date().toISOString()
  };
  const { data, error } = await getSupabaseClient().rpc('refund_invoice_payment', payload);
  if (error) throw error;
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || entry.created_by !== actorId || entry.entry_type !== 'refund') {
    throw new Error('Refund actor/type verification failed.');
  }
  return entry;
}
