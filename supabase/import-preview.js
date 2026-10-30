import { normalizePatient } from './patient-validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULE_KEYS = [
  'patients', 'appts', 'chairs', 'procs', 'items', 'sups', 'labs',
  'lab', 'audit', 'users', 'branches'
];

/**
 * Build a privacy-conscious, read-only preview of a legacy local D object.
 * This function never creates a Supabase client and never writes data.
 *
 * A patient is "demographicReady" only when its basic fields validate and its
 * local branch has an explicit remote UUID mapping. This is NOT permission to
 * import the patient yet: child clinical/financial records need separate,
 * reviewed importers before a complete migration can be declared safe.
 */
export function previewLocalImport({ localState, clinicId, branchMap } = {}) {
  if (!localState || typeof localState !== 'object' || Array.isArray(localState)) {
    throw new Error('A valid local clinic backup object is required.');
  }
  if (!UUID.test(String(clinicId || ''))) {
    throw new Error('A valid remote clinic UUID is required.');
  }
  if (!branchMap || typeof branchMap !== 'object' || Array.isArray(branchMap)) {
    throw new Error('An explicit local-to-remote branch mapping is required.');
  }
  if (!Array.isArray(localState.patients) || !Array.isArray(localState.branches)) {
    throw new Error('Backup must include patients and branches arrays.');
  }

  const remoteBranchIds = new Set();
  for (const [localBranchId, remoteBranchId] of Object.entries(branchMap)) {
    if (!localBranchId || !UUID.test(String(remoteBranchId || ''))) {
      throw new Error('Every mapped branch must have a local ID and a valid remote UUID.');
    }
    if (remoteBranchIds.has(remoteBranchId)) {
      throw new Error('Two local branches cannot map to the same remote branch in this preview.');
    }
    remoteBranchIds.add(remoteBranchId);
  }

  const patientIssues = [];
  let demographicReady = 0;
  let clinicalChildrenPending = 0;
  for (const [index, patient] of localState.patients.entries()) {
    const localId = String(patient?.id || patient?.no || index + 1);
    try {
      normalizePatient(patient);
      const localBranchId = String(patient?.br ?? patient?.branch_id ?? '');
      if (!localBranchId || !Object.prototype.hasOwnProperty.call(branchMap, localBranchId)) {
        throw new Error('Patient branch has no explicit remote mapping.');
      }
      demographicReady += 1;
      const childKeys = ['visits', 'mh', 'teeth', 'perio', 'rx', 'cons', 'plan', 'pay'];
      if (childKeys.some(key => Array.isArray(patient?.[key]) ? patient[key].length > 0 : Boolean(patient?.[key]))) {
        clinicalChildrenPending += 1;
      }
    } catch (error) {
      patientIssues.push({ localRecord: localId, reason: error instanceof Error ? error.message : 'Invalid patient data.' });
    }
  }

  const moduleCounts = {};
  for (const key of MODULE_KEYS) {
    const value = localState[key];
    moduleCounts[key] = Array.isArray(value) ? value.length : 0;
  }
  const unmodeledKeys = Object.keys(localState)
    .filter(key => !['settings', 'branches', 'users', 'patients', 'audit'].includes(key))
    .filter(key => !MODULE_KEYS.includes(key))
    .sort();

  return {
    mode: 'preview-only',
    writesPerformed: 0,
    clinicId,
    counts: {
      branches: localState.branches.length,
      users: Array.isArray(localState.users) ? localState.users.length : 0,
      patients: localState.patients.length,
      patientDemographicReady: demographicReady,
      patientsWithChildRecordsPending: clinicalChildrenPending,
      patientsBlocked: patientIssues.length,
      modules: moduleCounts
    },
    branchMapping: {
      localBranches: localState.branches.length,
      mappedLocalBranches: localState.branches.filter(b => Object.prototype.hasOwnProperty.call(branchMap, String(b?.id ?? ''))).length,
      unmappedLocalBranches: localState.branches.filter(b => !Object.prototype.hasOwnProperty.call(branchMap, String(b?.id ?? ''))).map(b => String(b?.id ?? '(missing id)'))
    },
    patientIssues,
    unmodeledKeys,
    warnings: [
      'Preview only: no records were uploaded or changed.',
      'Demographic-ready patients are not a complete migration; nested clinical and financial records need their own reviewed importers.',
      'Local user passwords, session tokens, recovery tokens, and local audit identities must not be imported as Supabase credentials or trusted actors.',
      'Do not enable production import until duplicate handling, rollback, RLS, and two-device tests pass.'
    ]
  };
}
