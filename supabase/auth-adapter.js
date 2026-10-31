/*
 * Supabase Auth adapter prototype for Dental Clinic OS.
 *
 * Used by the isolated cloud portal for email/password authentication and clinic
 * membership lookup. It does not replace the app's local login or sync the local
 * D object. Remote data access remains limited to the guarded prototype services.
 *
 * Configure the URL and publishable/anon key through a deployment-time config.
 * Never place a service_role/secret key here.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let client = null;

export function configureSupabase({ url, publishableKey }) {
  if (!url || !publishableKey) {
    throw new Error('Supabase URL and publishable key are required.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Unexpected Supabase project URL.');
  }
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'dcos_supabase_auth_v1'
    },
    global: {
      headers: { 'X-Client-Info': 'dental-clinic-web-prototype' }
    }
  });
  return client;
}

export function getSupabaseClient() {
  if (!client) throw new Error('Supabase client has not been configured.');
  return client;
}

export async function signUpWithEmail(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const rawPassword = String(password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('أدخل بريدًا إلكترونيًا صحيحًا.');
  }
  if (rawPassword.length < 8) {
    throw new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.');
  }
  const { data, error } = await getSupabaseClient().auth.signUp({
    email: normalizedEmail,
    password: rawPassword
  });
  if (error) throw error;
  return data;
}

export async function resendSignupConfirmation(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('أدخل البريد الإلكتروني الذي سجلت به.');
  }
  const { data, error } = await getSupabaseClient().auth.resend({
    type: 'signup',
    email: normalizedEmail
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword(email, password) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim().toLowerCase(),
    password: String(password || '')
  });
  if (error) throw error;
  if (!data.user?.email_confirmed_at && !data.user?.confirmed_at) {
    await supabase.auth.signOut();
    throw new Error('يجب تأكيد البريد الإلكتروني من الرسالة قبل تسجيل الدخول.');
  }
  return data;
}

export async function signInWithIdentity(identifier, password) {
  const value = String(identifier || '').trim();
  if (!value) throw new Error('أدخل البريد الإلكتروني أو اسم المستخدم.');
  if (value.includes('@')) return signInWithPassword(value, password);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('clinic-auth', {
    body: { action: 'login', username: value.toLowerCase(), password: String(password || '') }
  });
  if (error) throw error;
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error('تعذر إنشاء جلسة الدخول السحابية.');
  }
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token
  });
  if (sessionError) throw sessionError;
  return sessionData;
}

export async function createClinicStaff({ displayName, username, password, role, branchId } = {}) {
  const { data, error } = await getSupabaseClient().functions.invoke('clinic-auth', {
    body: {
      action: 'create_staff',
      display_name: String(displayName || '').trim(),
      username: String(username || '').trim().toLowerCase(),
      password: String(password || ''),
      role: String(role || ''),
      branch_id: String(branchId || '')
    }
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذر إنشاء حساب الموظف.');
  return data;
}

export async function listClinicStaff() {
  const { data, error } = await getSupabaseClient().functions.invoke('clinic-auth', {
    body: { action: 'list_staff' }
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذر تحميل حسابات العاملين.');
  return data.staff || [];
}

export async function updateClinicStaffPermissions(userId, permissions) {
  const { data, error } = await getSupabaseClient().functions.invoke('clinic-auth', {
    body: { action: 'manage_permissions', user_id: userId, permissions }
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || 'تعذر تحديث صلاحيات الموظف.');
  return data;
}

export async function signOutSupabase() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export async function getCurrentSupabaseSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentClinicMembership() {
  const supabase = getSupabaseClient();
  const session = await getCurrentSupabaseSession();
  if (!session?.user) return null;

  // RLS limits this query to the signed-in user's own membership and memberships
  // for clinics they own. The app must still validate active membership and branch
  // assignment before exposing any screen or data.
  const { data, error } = await supabase
    .from('clinic_members')
    .select('clinic_id,user_id,role,active,created_at')
    .eq('user_id', session.user.id)
    .eq('active', true)
    .limit(2);
  if (error) throw error;
  if (!data?.length) return null;
  if (data.length > 1) {
    throw new Error('Multiple clinic memberships found; clinic selection is required.');
  }
  return { session, membership: data[0] };
}


/**
 * Return only active branches explicitly assigned to the authenticated member.
 * This is for UI selection; table RLS must independently enforce the same scope.
 */
export async function listAssignedRemoteBranches(clinicId) {
  const supabase = getSupabaseClient();
  const session = await getCurrentSupabaseSession();
  if (!session?.user?.id) throw new Error('Sign in before loading clinic branches.');
  if (typeof clinicId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
    throw new Error('A valid remote clinic ID is required.');
  }

  const { data: membership, error: membershipError } = await supabase
    .from('clinic_members')
    .select('role')
    .eq('clinic_id', clinicId)
    .eq('user_id', session.user.id)
    .eq('active', true)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error('Active clinic membership is required.');

  let query = supabase
    .from('clinic_branches')
    .select('id,name,address,phone,active')
    .eq('clinic_id', clinicId)
    .eq('active', true);

  if (membership.role !== 'owner') {
    const { data: assignments, error: assignmentError } = await supabase
      .from('clinic_member_branches')
      .select('branch_id')
      .eq('clinic_id', clinicId)
      .eq('user_id', session.user.id);
    if (assignmentError) throw assignmentError;
    const ids = [...new Set((assignments || []).map(row => row.branch_id).filter(Boolean))];
    if (!ids.length) return [];
    query = query.in('id', ids);
  }

  const { data: branches, error: branchError } = await query.order('name', { ascending: true });
  if (branchError) throw branchError;
  return branches || [];
}

/*
 * Intentionally omitted here:
 * - client-side sign-up/invite or role assignment;
 * - writing patient/clinical/financial data;
 * - importing local D into remote tables;
 * - assuming a user is an owner because of local app data.
 *
 * Staff provisioning must be performed by a trusted owner-authorized backend flow.
 */
