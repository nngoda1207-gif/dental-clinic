import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth = readFileSync('supabase/functions/clinic-auth/index.ts', 'utf8');
const app = readFileSync('index.html', 'utf8');
assert.ok(auth.includes('function permissionsForRole(role:string)'), 'staff provisioning must define role permissions');
for (const [role, codes] of Object.entries({
  manager: ['pv','pa','pe','pr','ex','au','br'],
  dentist: ['pv','pa','pe'],
  nurse: ['pv','pa','pe'],
  reception: ['pv','pa','pe'],
  accountant: ['pv','ex'],
  readonly: ['pv'],
  invmgr: ['im','iv']
})) {
  const start = auth.indexOf(role + ':[');
  assert.ok(start >= 0, 'missing permission defaults for ' + role);
  for (const code of codes) assert.ok(auth.slice(start, start + 120).includes('"' + code + '"'), role + ' must retain ' + code);
}
assert.ok(auth.includes('permissions:permissionsForRole(role)'), 'new staff memberships must persist their role permissions');
assert.ok(app.includes("invmgr:'مسؤول المخزون'"), 'inventory manager must have a visible role label');
assert.ok(app.includes("invmgr:['im','iv']"), 'inventory manager UI gates must match database permissions');
assert.ok(app.includes('const role=identity.role;'), 'login must not downgrade inventory managers to read-only');
console.log('Cloud staff permission mapping checks passed.');
