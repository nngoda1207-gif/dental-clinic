import { previewLocalImport } from './import-preview.js';
import { normalizePatient } from './patient-validation.js';
import { createPatientInAssignedBranch } from './patient-sync-service.js';

const digits = value => String(value || '').replace(/\D/g, '');
const sameIdentity = (local, remote) =>
  String(local?.name ?? local?.full_name ?? '').trim().toLocaleLowerCase() ===
    String(remote?.name ?? '').trim().toLocaleLowerCase() &&
  digits(local?.ph ?? local?.phone) === digits(remote?.ph ?? remote?.phone);

/**
 * Read-only patient demographic import preview. A file number is the database
 * uniqueness key within a clinic branch; phone alone is never treated as unique.
 */
export function preparePatientImport({ localState, clinicId, branchMap, remotePatients = [] } = {}) {
  const base = previewLocalImport({ localState, clinicId, branchMap });
  const remoteByKey = new Map();
  for (const row of remotePatients) {
    const key = String(row.br || row.branch_id || '') + '::' + String(row.no || row.file_no || '');
    if (!remoteByKey.has(key)) remoteByKey.set(key, []);
    remoteByKey.get(key).push(row);
  }

  const seenLocal = new Set();
  const rows = [];
  for (const [index, patient] of localState.patients.entries()) {
    const localId = String(patient?.id || patient?.no || index + 1);
    const localBranchId = String(patient?.br ?? patient?.branch_id ?? '');
    const remoteBranchId = branchMap[localBranchId];
    const fileNo = String(patient?.no ?? patient?.file_no ?? '').trim();
    if (!fileNo) {
      rows.push({ localId, state: 'blocked', reason: 'رقم الملف غير موجود؛ لن يتم توليده تلقائيًا.' });
      continue;
    }
    const issue = base.patientIssues.find(item => item.localRecord === localId);
    if (issue || !remoteBranchId) {
      rows.push({ localId, state: 'blocked', reason: issue?.reason || 'الفرع المحلي غير مربوط بفرع سحابي.' });
      continue;
    }
    try { normalizePatient(patient); }
    catch (error) {
      rows.push({ localId, state: 'blocked', reason: error.message });
      continue;
    }
    const key = remoteBranchId + '::' + fileNo;
    if (seenLocal.has(key)) {
      rows.push({ localId, state: 'conflict', reason: 'رقم الملف مكرر داخل البيانات المحلية لنفس الفرع.' });
      continue;
    }
    seenLocal.add(key);
    const matches = remoteByKey.get(key) || [];
    if (matches.length) {
      rows.push({
        localId,
        state: matches.some(remote => sameIdentity(patient, remote)) ? 'duplicate' : 'conflict',
        reason: matches.some(remote => sameIdentity(patient, remote))
          ? 'السجل موجود بالفعل بنفس رقم الملف والاسم والهاتف؛ سيتم تخطيه دون تعديل.'
          : 'رقم الملف مستخدم لسجل مختلف؛ يلزم مراجعة يدوية.'
      });
      continue;
    }
    rows.push({ localId, state: 'new', reason: 'جاهز لإضافة بيانات المريض الأساسية فقط.' });
  }
  const counts = Object.fromEntries(['new', 'duplicate', 'conflict', 'blocked'].map(state =>
    [state, rows.filter(row => row.state === state).length]));
  return { mode: 'patient-demographics-only', writesPerformed: 0, counts, rows };
}

/**
 * Explicitly invoked importer. Rows are inserted individually; existing remote
 * records are never updated. If interrupted, rerun preview: unique file_no keys
 * classify already-created rows as duplicates rather than creating them again.
 */
export async function importNewPatients({ localState, branchMap, preview } = {}) {
  if (!preview || preview.mode !== 'patient-demographics-only' || preview.writesPerformed !== 0) {
    throw new Error('A fresh patient import preview is required.');
  }
  const results = [];
  for (const row of preview.rows.filter(item => item.state === 'new')) {
    const patient = localState.patients.find((item, index) =>
      String(item?.id || item?.no || index + 1) === row.localId);
    if (!patient) {
      results.push({ localId: row.localId, state: 'failed', reason: 'لم يتم العثور على السجل المحلي.' });
      continue;
    }
    try {
      const branchId = branchMap[String(patient.br ?? patient.branch_id ?? '')];
      const fileNo = String(patient.no ?? patient.file_no ?? '').trim();
      await createPatientInAssignedBranch({ branchId, fileNo, patient });
      results.push({ localId: row.localId, state: 'imported' });
    } catch (error) {
      results.push({ localId: row.localId, state: 'failed', reason: error?.message || 'فشل رفع السجل.' });
    }
  }
  return {
    results,
    imported: results.filter(row => row.state === 'imported').length,
    failed: results.filter(row => row.state === 'failed').length
  };
}
