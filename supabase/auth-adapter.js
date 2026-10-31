/*
 * Supabase Auth adapter prototype for Dental Clinic OS.
 *
 * This module is intentionally NOT wired into index.html yet. Integrate only after
 * the schema and RLS policies pass supabase/TEST_PLAN.md. The app currently uses
 * a single localStorage object, so enabling remote writes before the data-access
 * layer and per-role RLS are ready could expose patient data.
 *
 * Configure the URL and publishable/anon key through a deployment-time config.
 * Never place a service_role/secret key here.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

let client = null;
let clientConfig = null;
let oauthListenerInstalled = false;

async function installOAuthReturnHandler() {
  if (oauthListenerInstalled || !window.Capacitor?.isNativePlatform?.()) return;
  oauthListenerInstalled = true;
  await App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith('com.dentalclinic.os://auth-callback')) return;
    try {
      const callback = new URL(url);
      const code = callback.searchParams.get('code');
      if (!code) throw new Error('لم يصل رمز تسجيل الدخول من GitHub.');
      const { error } = await getSupabaseClient().auth.exchangeCodeForSession(code);
      if (error) throw error;
      await Browser.close().catch(() => {});
      window.dispatchEvent(new CustomEvent('dcos-oauth-authenticated'));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('dcos-oauth-error', { detail: error?.message || 'تعذر إكمال تسجيل الدخول.' }));
    }
  });
}

export function configureSupabase({ url, publishableKey }) {
  if (!url || !publishableKey) {
    throw new Error('Supabase URL and publishable key are required.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Unexpected Supabase project URL.');
  }
  if (client && clientConfig?.url === url && clientConfig?.publishableKey === publishableKey) return client;
  clientConfig = { url, publishableKey };
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
  installOAuthReturnHandler().catch(() => {});
  return client;
}

export function getSupabaseClient() {
  if (!client) throw new Error('Supabase client has not been configured.');
  return client;
}

export async function signInWithGitHub() {
  const native = Boolean(window.Capacitor?.isNativePlatform?.());
  const redirectTo = native
    ? 'com.dentalclinic.os://auth-callback'
    : window.location.origin + window.location.pathname;
  let data;
  try {
    const result = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo, skipBrowserRedirect: native }
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message) || error instanceof TypeError) {
      const host = (() => { try { return new URL(clientConfig?.url || '').host; } catch { return 'عنوان Supabase'; } })();
      throw new Error('التطبيق لم يستطع الوصول إلى خادم Supabase (' + host + '). تحقق من اتصال الإنترنت، ثم تأكد أن رابط المشروع صحيح وأن خدمة Supabase متاحة. لم نصل بعد إلى خطوة GitHub.');
    }
    throw error;
  }
  if (native) {
    if (!data?.url) throw new Error('اتصل التطبيق بـ Supabase لكن لم يرجع رابط GitHub. راجع تفعيل GitHub داخل Supabase Auth → Providers.');
    try {
      await Browser.open({ url: data.url });
    } catch (error) {
      throw new Error('تم الاتصال بـ Supabase وتجهيز رابط GitHub، لكن تعذر فتح نافذة المتصفح داخل التطبيق. أعد المحاولة وتأكد من تحديث مكونات Android.');
    }
  }
  return data;
}

export async function signInWithUsername(username, password) {
  const client = getSupabaseClient();
  const response = await fetch(clientConfig.url + '/functions/v1/clinic-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: clientConfig.publishableKey },
    body: JSON.stringify({ action: 'login', username: String(username || '').trim().toLowerCase(), password: String(password || '') })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.session?.access_token || !result.session?.refresh_token) throw new Error(result.error || 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  const { data, error } = await client.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
  if (error) throw error;
  return data;
}

export async function createClinicStaffAccount({ username, password, role, branchId }) {
  const client = getSupabaseClient();
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!current.session?.access_token) throw new Error('سجّل الدخول بحساب العيادة أولًا.');
  const response = await fetch(clientConfig.url + '/functions/v1/clinic-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: clientConfig.publishableKey, Authorization: 'Bearer ' + current.session.access_token },
    body: JSON.stringify({ action: 'create_staff', username, password, role, branchId })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'تعذر إنشاء حساب الموظف.');
  return result;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || '')
  });
  if (error) throw error;
  return data;
}

/**
 * Create a durable Supabase Auth identity. Clinic ownership is deliberately
 * provisioned separately, after email confirmation/session establishment.
 */
export async function signUpWithPassword(email, password) {
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  if (!cleanEmail) throw new Error('أدخل البريد الإلكتروني.');
  if (cleanPassword.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
  const { data, error } = await getSupabaseClient().auth.signUp({
    email: cleanEmail,
    password: cleanPassword,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  if (error) throw error;
  return data;
}

/** Send a password-reset email without exposing whether an account exists. */
export async function requestPasswordReset(email) {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) throw new Error('أدخل البريد الإلكتروني أولًا.');
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(cleanEmail, {
    redirectTo: window.location.origin + window.location.pathname
  });
  if (error) throw error;
}

/** Complete a password reset after Supabase redirects back with a recovery session. */
export async function updatePassword(newPassword) {
  const password = String(newPassword || '');
  if (password.length < 8) throw new Error('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.');
  const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error('افتح رابط استعادة كلمة المرور من نفس الجهاز أولًا.');
  const { error } = await getSupabaseClient().auth.updateUser({ password });
  if (error) throw error;
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

  const { data: assignments, error: assignmentError } = await supabase
    .from('clinic_member_branches')
    .select('branch_id')
    .eq('clinic_id', clinicId)
    .eq('user_id', session.user.id);
  if (assignmentError) throw assignmentError;
  const ids = [...new Set((assignments || []).map(row => row.branch_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data: branches, error: branchError } = await supabase
    .from('clinic_branches')
    .select('id,name,address,phone,active')
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .in('id', ids)
    .order('name', { ascending: true });
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
