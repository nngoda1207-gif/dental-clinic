export function normalizePatient(input) {
  if (!input || typeof input !== 'object') throw new Error('Patient data is required.');
  const full_name = String(input.name ?? input.full_name ?? '').trim();
  if (!full_name || full_name.length > 200) {
    throw new Error('Patient name must contain 1–200 characters.');
  }
  const phone = String(input.ph ?? input.phone ?? '').trim();
  if (phone.replace(/\D/g, '').length < 8) {
    throw new Error('A valid patient phone number is required.');
  }
  const rawSex = String(input.g ?? input.sex ?? '').trim();
  const sex = rawSex === 'ذكر' ? 'male'
    : rawSex === 'أنثى' ? 'female'
    : rawSex === '' ? ''
    : ['male', 'female', 'other'].includes(rawSex) ? rawSex : null;
  if (sex === null) throw new Error('Sex must be male, female, other, or empty.');

  const rawStatus = input.st ?? input.status ?? 'active';
  const status = ['active', 'inactive', 'archived'].includes(rawStatus) ? rawStatus : null;
  if (status === null) throw new Error('Patient status is invalid.');

  const dob = String(input.dob ?? input.date_of_birth ?? '').trim();
  if (dob) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    if (!match) throw new Error('Date of birth must use YYYY-MM-DD format.');
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText), month = Number(monthText), day = Number(dayText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day || year < 1900 || parsed.getTime() > Date.now()) {
      throw new Error('Date of birth must be a valid date in the past.');
    }
  }
  if (phone.length > 40) throw new Error('Patient phone number is too long.');
  const phoneAlt = String(input.ph2 ?? input.phone_alt ?? '').trim();
  const email = String(input.em ?? input.email ?? '').trim();
  const address = String(input.ad ?? input.address ?? '').trim();
  const emergencyContact = String(input.ec ?? input.emergency_contact ?? '').trim();
  if (phoneAlt.length > 40 || email.length > 254 || address.length > 500 ||
      emergencyContact.length > 200) {
    throw new Error('One or more patient contact fields are too long.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Patient email address is invalid.');
  }
  return {
    full_name,
    phone,
    phone_alt: phoneAlt,
    email,
    date_of_birth: dob || null,
    sex,
    address,
    emergency_contact: emergencyContact,
    status
  };
}

