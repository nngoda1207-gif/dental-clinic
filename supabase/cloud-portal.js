window.addEventListener('dcos:cloud-user-ready', async () => {
  if (!activeMembership) return;
  const mappedRemoteBranchIds = new Set(Object.values(getSavedBranchMap()).map(String));
  for (const branch of activeBranches) {
    if (!mappedRemoteBranchIds.has(String(branch.id))) continue;
    startAppointmentRealtime(branch.id);
    // Hydrate the complete remote patient directory before syncing dependent
    // appointments, treatment plans, lab cases and finance records.
    await refreshCloudPatientsForBranch(branch.id);
    syncAllCloudModulesForBranch(branch.id, false).catch(() => {});
  }
});