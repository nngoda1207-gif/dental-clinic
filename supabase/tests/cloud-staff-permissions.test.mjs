import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auth = readFileSync('supabase/functions/clinic-auth/index.ts', 'utf8');
const app = readFileSync('index.html', 'utf8');
const portal = readFileSync('supabase/cloud-portal.js', 'utf8');
assert.ok(auth.includes('const DEFAULT_PERMISSIONS:Record<string,string[]>'), 'staff provisioning must define role permissions');
for (const [role, codes] of Object.entries({
  manager: ['pv','pa','pe','pr','ex','au','br'],
  dentist: ['pv','pa','pe'],
  nurse: ['pv','pa','pe'],
  reception: ['pv','pa','pe'],
  accountant: ['pv','ex'],
  readonly: ['pv'],
  invmgr: ['pv','im','iv']
})) {
  const start = auth.indexOf(role + ':[');
  assert.ok(start >= 0, 'missing permission defaults for ' + role);
  for (const code of codes) assert.ok(auth.slice(start, start + 120).includes('"' + code + '"'), role + ' must retain ' + code);
}
assert.ok(auth.includes('permissions:DEFAULT_PERMISSIONS[role]||[]'), 'new staff memberships must persist their role permissions');
assert.ok(auth.includes('action==="manage_permissions"') && auth.includes('action==="list_staff"'), 'owner permission management endpoints must remain available');
assert.ok(portal.includes("body: { action: 'list_staff' }"), 'owner UI must list cloud staff');
assert.ok(portal.includes("action: 'manage_permissions'"), 'owner UI must save cloud permissions');
assert.ok(portal.includes('permissions: Array.isArray(membership.permissions)'), 'cloud login must return saved membership permissions');
assert.ok(app.includes("invmgr:'مسؤول المخزون'"), 'inventory manager must have a visible role label');
assert.ok(app.includes("invmgr:['im','iv']"), 'inventory manager UI gates must remain explicit');
assert.ok(app.includes('const role=identity.role;'), 'login must not downgrade inventory managers to read-only');
console.log('Cloud staff permission mapping checks passed.');
