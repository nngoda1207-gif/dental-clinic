import assert from 'node:assert/strict';
import { normalizePatient } from '../patient-validation.js';

const valid = normalizePatient({
  name: 'Test Patient',
  ph: '01012345678',
  dob: '2000-02-29',
  g: 'أنثى',
  st: 'active',
  em: 'patient@example.com',
  en: 'Test Patient EN',
  gov: 'Dakahlia',
  so: 'إحالة',
  tg: ['متابعة', 'تقويم']
});
assert.equal(valid.full_name, 'Test Patient');
assert.equal(valid.sex, 'female');
assert.equal(valid.date_of_birth, '2000-02-29');
assert.equal(valid.english_name, 'Test Patient EN');
assert.equal(valid.governorate, 'Dakahlia');
assert.equal(valid.source, 'إحالة');
assert.deepEqual(valid.tags, ['متابعة', 'تقويم']);

for (const dob of ['2023-02-29', '2024-13-01', '2024-04-31', '2999-01-01', '1899-12-31']) {
  assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', dob }), /Date of birth/);
}
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', st: 'unexpected' }), /status is invalid/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', g: 'unknown' }), /Sex must be/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', em: 'not-an-email' }), /email address is invalid/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', ad: 'x'.repeat(501) }), /fields are too long/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '123' }), /valid patient phone/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', tg: ['x'.repeat(81)] }), /Patient tags/);
assert.throws(() => normalizePatient({ name: 'Test', ph: '01012345678', gov: 'x'.repeat(121) }), /profile fields are too long/);

console.log('Patient validation runtime tests passed.');
