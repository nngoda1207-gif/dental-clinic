/*
 * Isolated Supabase cloud portal for the existing local-first app.
 * This first integration enables Supabase Auth, clinic/branch context and
 * branch-scoped patient sync. Demographic changes cross the local/cloud boundary
 * only after backup, explicit branch mapping and owner opt-in; other D modules stay local.
 */
import {
  configureSupabase, getSupabaseClient, signInWithUsername, createClinicStaffAccount,
  signOutSupabase, getCurrentClinicMembership, listAssignedRemoteBranches
} from './auth-adapter.js';
import { listAllPatientsForAssignedBranch, watchPatientsForAssignedBranch, upsertPatientInAssignedBranch, updatePatientInAssignedBranch } from './patient-sync-service.js';
import { preparePatientImport, importNewPatients } from './patient-import-service.js';

// Public project configuration: safe to ship in the app. Never put service-role/secret keys here.
window.DCOS_SUPABASE_CONFIG = window.DCOS_SUPABASE_CONFIG || {
  url: 'https://zvaccqmdqtwrgzqgjtbl.supabase.co',
  publishableKey: 'sb_publishable_VwUoYJZ2hoEYKbXXZdOINQ_MJbrYDIT'
};
const CONFIG_KEY = 'dcos_supabase_public_config_v1';
const BRANCH_MAP_KEY = 'dcos_supabase_branch_map_v1';
const PATIENT_QUEUE_KEY = 'dcos_patient_sync_queue_v1';
const PATIENT_CONFLICTS_KEY = 'dcos_patient_sync_conflicts_v1';
let activeMembership = null, activeBranches = [], localImportSnapshot = null, importBranchMap = null, importPreview = null, localBackupExported = false, backupExportStarted = false;
let patientRealtimeUnsubscribe = null, patientRefreshInFlight = false, patientQueueFlushInFlight = false, initialImportComplete = false;
const el = (tag, attrs = {}, html = '') => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => k === 'class' ? n.className = v : n.setAttribute(k, v));
  n.innerHTML = html;
  return n;
};
const style = el('style');
style.textContent = `
#dcos-cloud-launch{position:fixed;left:14px;bottom:16px;z-index:80;border:0;border-radius:10px;padding:10px 14px;background:#17324d;color:#fff;font:600 14px Cairo, sans-serif;box-shadow:0 3px 14px #0003;cursor:pointer}
#dcos-cloud-panel{position:fixed;inset:0;z-index:100;background:#0008;display:none;align-items:center;justify-content:center;padding:12px;font-family:Cairo, sans-serif}
#dcos-cloud-panel.open{display:flex}
#dcos-cloud-card{background:var(--cd,#fff);color:var(--tx,#14262e);width:min(680px,100%);max-height:92vh;overflow:auto;border-radius:14px;padding:18px;border:1px solid var(--bd,#d8e2e0);direction:rtl}
#dcos-cloud-card input,#dcos-cloud-card select,#dcos-cloud-card textarea{width:100%;padding:9px;margin:4px 0 10px;border:1px solid var(--bd,#d8e2e0);border-radius:8px;background:var(--bg,#f3f6f5);color:inherit;font:inherit}
#dcos-cloud-card button{font:inherit;border-radius:8px;padding:8px 13px;margin:3px;cursor:pointer;border:1px solid var(--ac,#1f8a80)}
#dcos-cloud-card .primary{background:var(--ac,#1f8a80);color:white}
#dcos-cloud-card .muted{color:var(--mu,#5b6f77);font-size:13px}
#dcos-cloud-card .cloud-row{padding:8px 4px;border-bottom:1px solid var(--bd,#d8e2e0)}
#dcos-cloud-card .cloud-actions{display:flex;gap:6px;flex-wrap:wrap}
`;
document.head.append(style);

const launch = el('button', { id: 'dcos-cloud-launch', type: 'button' }, '☁ المزامنة السحابية');
const panel = el('div', { id: 'dcos-cloud-panel' });
panel.innerHTML = `<section id="dcos-cloud-card" role="dialog" aria-modal="true" aria-labelledby="dcos-cloud-title">
  <div style="display:flex;align-items:center;gap:10px;justify-content:space-between"><h2 id="dcos-cloud-title" style="margin:0">حساب العيادة</h2><button id="dcos-cloud-close" type="button">إغلاق</button></div>
  <div class="cloud-row"><b>دخول مستقل لكل عيادة ولكل موظف.</b><p class="muted">استخدم اسم المستخدم وكلمة المرور اللذين سلّمهما لك مسؤول العيادة. لا تحتاج إلى بريد إلكتروني.</p><p class="muted">كل مستخدم يرى بيانات العيادة المشتركة وفق دوره والفرع المخصص له. لا تستخدم إيميل أو كلمة مرور المالك على أجهزة الموظفين.</p></div>
  <div id="dcos-cloud-config">
    <label>رابط مشروع Supabase<input id="dcos-sb-url" type="url" placeholder="https://xxxx.supabase.co" autocomplete="url"></label>
    <label>Publishable / anon key<input id="dcos-sb-key" type="password" placeholder="المفتاح العام للمشروع فقط" autocomplete="off"></label>
    <button class="primary" id="dcos-save-config" type="button">حفظ إعداد الاتصال</button>
    <p class="muted">لا تضع Service Role أو Secret Key هنا. الإعدادات تحفظ على هذا الجهاز فقط.</p>
  </div>
  <details class="cloud-row" id="dcos-system-provisioning" open style="border:2px solid var(--ac,#1f8a80);border-radius:12px;padding:14px;margin:14px 0">
    <summary style="font-weight:700;cursor:pointer;font-size:16px">① إنشاء حساب عيادة جديد — مسؤول النظام</summary>
    <p class="muted">استخدم هذا القسم لإنشاء الحساب الأساسي للعيادة لأول مرة. لا تكتب اسم المستخدم في خانة اسم العيادة. بعد الإنشاء، سجّل الدخول من قسم الدخول أسفل هذه الشاشة. أدخل قيمة المفتاح المحفوظة في Supabase Secrets؛ لن يتم حفظها على الجهاز.</p>
    <label>اسم العيادة (الاسم الظاهر)<input id="dcos-provision-clinic-name" type="text" maxlength="160" autocomplete="off" placeholder="Elsharkawy Dental Clinic"></label>
    <label>اسم الفرع الرئيسي<input id="dcos-provision-branch-name" type="text" maxlength="160" value="الفرع الرئيسي" autocomplete="off"></label>
    <label>اسم مستخدم مالك العيادة (للدخول لاحقًا)<input id="dcos-provision-username" type="text" maxlength="32" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="amr.atef"></label>
    <label>كلمة مرور مالك العيادة<input id="dcos-provision-password" type="password" minlength="8" autocomplete="new-password" placeholder="8 أحرف على الأقل"></label>
    <label>مفتاح مسؤول النظام (قيمة Secret المحفوظة في Supabase)<input id="dcos-provision-key" type="password" autocomplete="off" placeholder="CLINIC_PROVISIONING_KEY value"></label>
    <button class="primary" id="dcos-provision-clinic" type="button">إنشاء حساب العيادة</button>
    <p id="dcos-provision-status" class="muted" role="status"></p>
  </details>
  <div id="dcos-cloud-auth">
    <label>اسم مستخدم العيادة<input id="dcos-sb-username" type="text" maxlength="32" placeholder="اسم المستخدم" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label>كلمة المرور<input id="dcos-sb-password" type="password" autocomplete="current-password" placeholder="كلمة المرور"></label>
    <div class="cloud-actions"><button class="primary" id="dcos-sb-login" type="button">دخول</button><button id="dcos-sb-logout" type="button" hidden>تسجيل الخروج</button></div>
    <p class="muted">هذا القسم للدخول فقط بعد إنشاء العيادة. حسابات الموظفين ينشئها مالك العيادة من داخل التطبيق.</p>
  </div>
  <div id="dcos-cloud-workspace" hidden></div>
  <p id="dcos-cloud-status" class="muted" role="status" aria-live="polite"></p>
</section>`;
document.body.append(launch, panel);

const $ = id => document.getElementById(id);
const status = message => { $('dcos-cloud-status').textContent = message || ''; };
function friendlyCloudError(error, fallback) {
  const message = String(error?.message || error || '');
  if (/Supabase URL and publishable key are required/i.test(message)) return 'إعداد الاتصال السحابي غير مكتمل. أدخل رابط المشروع والمفتاح العام أو استخدم نسخة التطبيق المجهزة بالإعدادات.';
  if (/Invalid login credentials|INVALID_CREDENTIALS/i.test(message)) return 'اسم المستخدم أو كلمة المرور غير صحيحين.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مرة أخرى.';
  if (/does not exist|Could not find the function|schema cache|PGRST202|PGRST205/i.test(message)) return 'قاعدة بيانات Supabase تحتاج تطبيق تحديثات العيادة. يلزم تطبيق ملفات migrations وملف OWNER_STAFF_SETUP.sql في Supabase SQL Editor بواسطة مسؤول المشروع.';
  if (/OWNER_REQUIRED/.test(message)) return 'إنشاء دعوات الموظفين متاح لحساب مالك العيادة فقط.';
  if (/BRANCH_NOT_AVAILABLE/.test(message)) return 'الفرع المحدد غير متاح. حدّث الصفحة واختر فرعًا نشطًا.';
  if (/INVALID_INVITE_ROLE/.test(message)) return 'الوظيفة المحددة غير صالحة. اختر وظيفة من القائمة.';
  if (/Password should be at least|password.*(weak|short)/i.test(message)) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
  return message || fallback;
}

const open = () => { const embedded = window.DCOS_SUPABASE_CONFIG; if (embedded?.url && embedded?.publishableKey) $('dcos-cloud-config').hidden = true; panel.classList.add('open'); };
window.openCloudPortal = open;
const close = () => panel.classList.remove('open');
launch.addEventListener('click', () => { open(); });

$('dcos-cloud-close').addEventListener('click', close);
panel.addEventListener('click', e => { if (e.target === panel) close(); });

function restoreConfig() {
  try {
    const embedded = window.DCOS_SUPABASE_CONFIG;
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    const c = embedded?.url && embedded?.publishableKey ? embedded : saved;
    if (c) {
      $('dcos-sb-url').value = c.url || '';
      $('dcos-sb-key').value = c.publishableKey || '';
      if (embedded?.url && embedded?.publishableKey) localStorage.setItem(CONFIG_KEY, JSON.stringify(embedded));
    }
  } catch {}
}
function configure() {
  const url = $('dcos-sb-url').value.trim();
  const publishableKey = $('dcos-sb-key').value.trim();
  configureSupabase({ url, publishableKey });
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, publishableKey }));
}
$('dcos-save-config').addEventListener('click', () => {
  try { configure(); status('تم حفظ إعداد الاتصال على هذا الجهاز.'); }
  catch (e) { status(e.message || 'تعذر إعداد الاتصال.'); }
});
$('dcos-provision-clinic').addEventListener('click', async () => {
  const button = $('dcos-provision-clinic'), output = $('dcos-provision-status');
  try {
    configure();
    const clinic_name = $('dcos-provision-clinic-name').value.trim();
    const branch_name = $('dcos-provision-branch-name').value.trim();
    const username = $('dcos-provision-username').value.trim().toLowerCase();
    const password = $('dcos-provision-password').value;
    const key = $('dcos-provision-key').value;
    if (!clinic_name || !branch_name || !username || !password || !key) throw new Error('أكمل بيانات العيادة والحساب ومفتاح مسؤول النظام.');
    button.disabled = true; output.textContent = 'جارٍ إنشاء حساب المالك والعيادة والفرع…';
    const { data, error } = await getSupabaseClient().functions.invoke('clinic-auth', {
      body: { action: 'provision_clinic', clinic_name, branch_name, username, password },
      headers: { Authorization: 'Bearer ' + key }
    });
    if (error) {
      let detail = error.message || 'تعذر إنشاء حساب العيادة.';
      try { const response = error.context?.clone?.(); if (response) { const payload = await response.json(); detail = payload?.error || detail; } } catch {}
      throw new Error(detail);
    }
    if (!data?.ok) throw new Error(data?.error || 'تعذر إنشاء حساب العيادة.');
    $('dcos-provision-password').value = ''; $('dcos-provision-key').value = '';
    output.textContent = 'تم إنشاء العيادة. اسم المستخدم الأساسي: ' + data.username + '. احفظ كلمة المرور التي أدخلتها في مكان آمن.';
    status('تم إنشاء حساب مالك العيادة بنجاح. يمكنك الآن تسجيل الدخول من الشاشة الرئيسية.');
  } catch (e) {
    const m = String(e?.message || '');
    output.textContent = m.includes('PROVISIONING_NOT_CONFIGURED') ? 'لم يتم ضبط CLINIC_PROVISIONING_KEY في Supabase Edge Function Secrets بعد.' :
      m.includes('FORBIDDEN') ? 'مفتاح مسؤول النظام غير صحيح.' :
      m.includes('INVALID_USERNAME') ? 'اسم المستخدم يجب أن يكون 3–32 حرفًا/رقمًا إنجليزيًا دون مسافات.' :
      m.includes('INVALID_PASSWORD') ? 'كلمة المرور يجب أن تكون من 8 إلى 128 حرفًا.' :
      m || 'تعذر إنشاء حساب العيادة.';
  } finally { button.disabled = false; }
});
$('dcos-sb-login').addEventListener('click', async () => {
  try {
    configure();
    status('جارٍ تسجيل الدخول والتحقق من عضوية العيادة…');
    await signInWithUsername($('dcos-sb-username').value, $('dcos-sb-password').value);
    $('dcos-sb-password').value = '';
    $('dcos-sb-logout').hidden = false;
    await loadWorkspace();
    flushPatientSyncQueue();
  } catch (e) { status(friendlyCloudError(e, 'فشل تسجيل الدخول.')); }
});
$('dcos-sb-logout').addEventListener('click', async () => {
  try {
    await signOutSupabase();
    if (patientRealtimeUnsubscribe) { patientRealtimeUnsubscribe(); patientRealtimeUnsubscribe = null; }
    $('dcos-cloud-workspace').hidden = true;
    $('dcos-cloud-workspace').innerHTML = '';
    $('dcos-sb-logout').hidden = true;
    status('تم تسجيل الخروج من الحساب السحابي.');
  } catch (e) { status(e.message || 'تعذر تسجيل الخروج.'); }
});

async function loadWorkspace() {
  activeMembership = null;
  activeBranches = [];
  const host = $('dcos-cloud-workspace');
  host.hidden = false;
  host.innerHTML = '<p class="muted">جارٍ تحميل صلاحياتك والفروع المتاحة…</p>';
  const result = await getCurrentClinicMembership();
  if (!result) {
    host.innerHTML = '<section class="cloud-row"><h3>الحساب غير مرتبط بعيادة</h3><p class="muted">راجع مسؤول النظام للتأكد من إنشاء حساب العيادة وربطه بالعيادة الصحيحة. إنشاء الحسابات الأساسية يتم بواسطة مسؤول النظام فقط.</p></section>';
    status('تم تسجيل الدخول، لكن الحساب غير مرتبط بعضوية عيادة نشطة.');
    return;
  }
  const membership = result.membership;
  activeMembership = membership;
  const branches = await listAssignedRemoteBranches(membership.clinic_id);
  activeBranches = branches;
  if (!branches.length) {
    host.innerHTML = '<p>الحساب عضو في العيادة، لكن لا يوجد فرع مسند إليه. اطلب من مالك العيادة إسناد فرع لهذا الحساب.</p>';
    status('تم التحقق من العضوية، ولا توجد فروع مسندة.');
    return;
  }
  host.innerHTML = `<p><b>الدور:</b> ${escapeHtml(membership.role)} <span class="muted">· تم التحقق من العضوية النشطة</span></p>
    <label>الفرع السحابي<select id="dcos-cloud-branch">${branches.map(b => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.name)}</option>`).join('')}</select></label>
    <div class="cloud-actions"><button class="primary" id="dcos-load-patients" type="button" >تحديث ومتابعة مرضى الفرع</button><button id="dcos-start-patient-import" type="button">استيراد المرضى المحليين</button></div>
    <div id="dcos-cloud-patients" class="muted">بيانات المرضى لا تُحمّل إلا بعد اختيار الفرع والضغط على الزر.</div><div id="dcos-patient-import" class="cloud-row" hidden></div>`;
  if (membership.role === 'owner') {
    const staffBox = el('section', { class: 'cloud-row' });
    staffBox.innerHTML = '<h3>إنشاء حساب موظف</h3><p class="muted">أنشئ اسم مستخدم وكلمة مرور لكل فرد في الفريق، وحدد وظيفته والفرع المسموح له. لا نطلب بريدًا إلكترونيًا.</p><label>اسم المستخدم<input id="dcos-staff-username" type="text" maxlength="32" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="مثال: nurse01"></label><label>كلمة المرور<input id="dcos-staff-password" type="password" minlength="8" autocomplete="new-password" placeholder="8 أحرف على الأقل"></label><label>الوظيفة<select id="dcos-staff-role"><option value="nurse">تمريض</option><option value="dentist">طبيب</option><option value="reception">استقبال</option><option value="accountant">حسابات</option><option value="manager">مدير</option><option value="invmgr">مسؤول مخزون</option><option value="readonly">قراءة فقط</option></select></label><label>الفرع<select id="dcos-staff-branch">' + branches.map(b => '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>').join('') + '</select></label><button class="primary" id="dcos-create-staff-account" type="button">إنشاء حساب الموظف</button><p id="dcos-staff-create-status" class="muted" role="status"></p>';
    host.prepend(staffBox);
    $('dcos-create-staff-account').addEventListener('click', createStaffAccount);
  }
  $('dcos-load-patients').addEventListener('click', loadPatients);
  $('dcos-cloud-branch').addEventListener('change', loadPatients);
  $('dcos-start-patient-import').addEventListener('click', beginPatientImport);
  status('الاتصال ناجح. تم التحقق من العضوية والفروع المسندة.');
  flushPatientSyncQueue();
}

async function createStaffAccount() {
 const button=$('dcos-create-staff-account'),output=$('dcos-staff-create-status');
 try{
  const username=$('dcos-staff-username').value.trim().toLowerCase(),password=$('dcos-staff-password').value,role=$('dcos-staff-role').value,branchId=$('dcos-staff-branch').value;
  if(!username||!password||!branchId)throw new Error('أكمل اسم المستخدم وكلمة المرور والفرع.');
  button.disabled=true;output.textContent='جارٍ إنشاء الحساب وربطه بالعيادة…';
  const created=await createClinicStaffAccount({username,password,role,branchId});
  $('dcos-staff-password').value='';
  output.textContent='تم إنشاء حساب '+created.username+' بوظيفة '+created.role+'. سلّم الموظف بيانات الدخول بشكل آمن.';
  status('تم إنشاء حساب الموظف وربطه بفرع العيادة.');
 }catch(e){
  const m=String(e?.message||'');
  output.textContent=m.includes('OWNER_REQUIRED')?'إنشاء حسابات الفريق متاح لمالك العيادة فقط.':m.includes('INVALID_USERNAME')?'اسم المستخدم غير صالح أو مستخدم بالفعل.':m.includes('INVALID_PASSWORD')?'كلمة المرور يجب أن تكون من 8 إلى 128 حرفًا.':m.includes('BRANCH_NOT_AVAILABLE')?'الفرع المحدد غير متاح لهذه العيادة.':m||'تعذر إنشاء الحساب.';
 }finally{button.disabled=false;}
}

function beginPatientImport() {
  const host = $('dcos-patient-import');
  try {
    const raw = localStorage.getItem('dcos1');
    if (!raw) throw new Error('لا توجد قاعدة بيانات محلية محفوظة على هذا الجهاز.');
    localImportSnapshot = JSON.parse(raw);
    if (!Array.isArray(localImportSnapshot.patients) || !Array.isArray(localImportSnapshot.branches)) throw new Error('بيانات المرضى أو الفروع المحلية غير مكتملة.');
    importPreview = null;
    localBackupExported = false;
    backupExportStarted = false;
    const options = activeBranches.map(b => '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>').join('');
    host.hidden = false;
    host.innerHTML = '<h3>نسخة احتياطية قبل النقل</h3><p class="muted">بيانات العيادة المحلية تشمل معلومات مرضى حساسة. نزّل نسخة JSON كاملة واحفظها في مكان آمن قبل متابعة الاستيراد. التنزيل لا يرفع النسخة إلى السحابة.</p><button class="primary" id="dcos-export-local-backup" type="button">تنزيل النسخة الاحتياطية المحلية</button><p id="dcos-backup-status" class="muted">يجب تنزيل النسخة الاحتياطية قبل معاينة الاستيراد.</p><h3>ربط الفروع المحلية بالسحابية</h3><p class="muted">اختر فرعًا سحابيًا لكل فرع محلي. لا يتم رفع بيانات في هذه الخطوة.</p>' +
      localImportSnapshot.branches.map((b,i) => '<label>' + escapeHtml(b.name || ('فرع ' + (i+1))) + '<select data-local-branch="' + escapeAttr(String(b.id ?? '')) + '"><option value="">اختر الفرع السحابي</option>' + options + '</select></label>').join('') +
      '<button class="primary" id="dcos-preview-patient-import" type="button">معاينة الاستيراد</button><div id="dcos-import-preview-result" class="muted"></div>';
    $('dcos-preview-patient-import').disabled = true;
    $('dcos-export-local-backup').addEventListener('click', exportLocalBackup);
    $('dcos-preview-patient-import').addEventListener('click', previewPatientImportNow);
    // A preview is valid only for the exact branch mapping used to create it.
    // Invalidate it immediately if any mapping changes, preventing confirmation
    // of an import against a stale or different branch selection.
    host.querySelectorAll('select[data-local-branch]').forEach(select => {
      select.addEventListener('change', () => {
        importPreview = null;
        const previewHost = $('dcos-import-preview-result');
        if (previewHost) previewHost.innerHTML = '<p class="muted">تغيّر ربط الفروع. أعد المعاينة قبل تأكيد أي استيراد.</p>';
        status('تم تغيير ربط الفروع؛ المعاينة السابقة لم تعد صالحة.');
      });
    });
    status('تم تجهيز البيانات المحلية للمعاينة فقط؛ لم يتم الرفع.');
  } catch (e) { status(e.message || 'تعذر تجهيز المعاينة.'); }
}

function exportLocalBackup() {
  try {
    if (!localImportSnapshot || typeof localImportSnapshot !== 'object') throw new Error('لا توجد بيانات محلية جاهزة للنسخ الاحتياطي.');
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify({format:'dental-clinic-os-local-backup',version:1,exportedAt:new Date().toISOString(),data:localImportSnapshot}, null, 2)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dental-clinic-backup-' + date + '.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    backupExportStarted = true;
    $('dcos-backup-status').innerHTML = 'بدأ تنزيل الملف. افتح مجلد التنزيلات وتأكد أن ملف النسخة الاحتياطية موجود ويمكن فتحه، ثم أكد ذلك للمتابعة. <button type="button" id="dcos-confirm-backup-saved">تأكدت من حفظ النسخة الاحتياطية</button>';
    $('dcos-confirm-backup-saved').addEventListener('click', confirmLocalBackupSaved);
    status('بدأ تنزيل النسخة الاحتياطية. لن تُتاح المعاينة حتى تؤكد بنفسك وجود الملف المحفوظ.');
  } catch (e) { status(e.message || 'تعذر تنزيل النسخة الاحتياطية.'); }
}

function confirmLocalBackupSaved() {
  if (!backupExportStarted) throw new Error('ابدأ تنزيل النسخة الاحتياطية أولًا.');
  localBackupExported = true;
  $('dcos-preview-patient-import').disabled = false;
  $('dcos-backup-status').textContent = 'أكدت وجود النسخة الاحتياطية على هذا الجهاز. احتفظ بها في مكان آمن قبل متابعة النقل.';
  status('تم تأكيد حفظ النسخة الاحتياطية يدويًا. يمكنك الآن معاينة الاستيراد.');
}

async function previewPatientImportNow() {
  const result = $('dcos-import-preview-result');
  try {
    if (!localBackupExported) throw new Error('نزّل النسخة الاحتياطية المحلية أولًا قبل معاينة الاستيراد.');
    const selects = [...$('dcos-patient-import').querySelectorAll('select[data-local-branch]')];
    importBranchMap = {};
    for (const select of selects) {
      if (!select.value) throw new Error('اربط كل الفروع المحلية بفرع سحابي قبل المعاينة.');
      importBranchMap[select.dataset.localBranch] = select.value;
    }
    const mappedBranches = Object.values(importBranchMap);
    if (new Set(mappedBranches).size !== mappedBranches.length) throw new Error('لا يمكن ربط فرعين محليين بنفس الفرع السحابي؛ اختر فرعًا مستقلًا لكل فرع.');
    const remoteIds = [...new Set(mappedBranches)];
    const lists = await Promise.all(remoteIds.map(branchId => listAllPatientsForAssignedBranch({branchId})));
    importPreview = preparePatientImport({localState:localImportSnapshot, clinicId:activeMembership.clinic_id, branchMap:importBranchMap, remotePatients:lists.flat()});
    const n = importPreview.counts;
    initialImportComplete = n.new === 0 && n.conflict === 0 && n.blocked === 0;
    result.innerHTML = '<p><b>معاينة — بيانات المرضى الأساسية فقط</b></p><p>جديد: ' + n.new + ' · موجود: ' + n.duplicate + ' · تعارض: ' + n.conflict + ' · مستبعد: ' + n.blocked + '</p>' +
      '<p class="muted">لن يتم رفع السجلات العلاجية أو الأشعة أو الوصفات أو المدفوعات، ولن يتم تعديل مريض موجود.</p><ul>' +
      importPreview.rows.filter(x => x.state !== 'new').slice(0,30).map(x => '<li>' + escapeHtml(x.localId) + ' — ' + escapeHtml(x.reason) + '</li>').join('') + '</ul>' +
      (n.new ? '<button class="primary" id="dcos-confirm-patient-import" type="button">تأكيد رفع المرضى الجدد فقط</button>' : '<p>لا توجد سجلات جديدة جاهزة للرفع.</p>') + '<button id="dcos-enable-patient-sync" type="button" ' + (initialImportComplete ? '' : 'disabled') + '>اعتماد ربط الفروع وتشغيل المزامنة التلقائية لبيانات المرضى الأساسية</button>' + (initialImportComplete ? '' : '<p class="muted">أكمل رفع السجلات الجديدة وحل التعارضات قبل تفعيل المزامنة التلقائية.</p>');
    if (n.new) $('dcos-confirm-patient-import').addEventListener('click', confirmPatientImport);
    $('dcos-enable-patient-sync').addEventListener('click', enablePatientSync);
    status('اكتملت المعاينة دون كتابة أي بيانات على Supabase.');
  } catch (e) { result.textContent = e.message || 'تعذر إعداد المعاينة.'; }
}

function enablePatientSync() {
  if (!importBranchMap || !Object.keys(importBranchMap).length) return;
  if (!initialImportComplete) { status('لا يمكن تفعيل المزامنة قبل اكتمال الاستيراد الأولي وحل التعارضات.'); return; }
  if (!window.confirm('سيتم حفظ ربط الفروع على هذا الجهاز. بعد ذلك ستتم مزامنة بيانات المرضى الأساسية عند حفظها، مع إبقاء السجلات الطبية والمالية محلية. هل توافق؟')) return;
  localStorage.setItem(BRANCH_MAP_KEY, JSON.stringify({ clinicId: activeMembership.clinic_id, map: importBranchMap }));
  status('تم اعتماد ربط الفروع. ستتم مزامنة بيانات المرضى الأساسية فقط عند الحفظ أو عودة الاتصال.');
  flushPatientSyncQueue();
}

async function confirmPatientImport() {
  const result = $('dcos-import-preview-result');
  const button = $('dcos-confirm-patient-import');
  if (!importPreview || !window.confirm('سيتم رفع ' + importPreview.counts.new + ' مريضًا جديدًا ببياناتهم الأساسية فقط. هل تريد المتابعة؟')) return;
  button.disabled = true;
  result.textContent = 'جارٍ رفع السجلات الجديدة واحدًا تلو الآخر…';
  try {
    const outcome = await importNewPatients({localState:localImportSnapshot, branchMap:importBranchMap, preview:importPreview});
    result.textContent = 'انتهى الاستيراد: تمت إضافة ' + outcome.imported + '، وفشل ' + outcome.failed + '. لم يتم رفع أي بيانات طبية فرعية.';
    window.dispatchEvent(new CustomEvent('dcos:cloud-patient-links', { detail: {
      links: outcome.results.filter(x => x.state === 'imported' && x.remoteId).map(x => {
        const local = localImportSnapshot.patients.find(p => String(p.id || p.no) === x.localId);
        return { localId: x.localId, remoteId: x.remoteId, remoteBranchId: x.remoteBranchId, remoteUpdatedAt: x.remoteUpdatedAt, localBranchId: String(local?.br ?? '') };
      })
    } }));
    if (outcome.failed === 0 && importPreview.counts.conflict === 0 && importPreview.counts.blocked === 0) {
      initialImportComplete = true;
      const enableButton = $('dcos-enable-patient-sync');
      if (enableButton) enableButton.disabled = false;
      status('اكتمل الاستيراد الأولي دون تعارض. يمكنك الآن اعتماد ربط الفروع لتشغيل مزامنة بيانات المرضى الأساسية.');
    } else status('الاستيراد غير مكتمل أو توجد تعارضات؛ لن تُفعّل المزامنة التلقائية حتى تُراجع.');
  } catch (e) { result.textContent = e.message || 'توقف الاستيراد بسبب خطأ.'; button.disabled = false; }
}


function dispatchCloudPatientsToLocal(branchId, patients) {
  const map = getSavedBranchMap();
  const localBranchId = Object.keys(map).find(key => map[key] === branchId);
  if (!localBranchId) return;
  window.dispatchEvent(new CustomEvent('dcos:cloud-patients', {
    detail: { localBranchId, patients }
  }));
}

async function loadPatients() {
  const branchId = $('dcos-cloud-branch').value;
  const host = $('dcos-cloud-patients');
  if (!branchId) return;
  if (patientRealtimeUnsubscribe) { patientRealtimeUnsubscribe(); patientRealtimeUnsubscribe = null; }
  host.textContent = 'جارٍ تحميل سجلات المرضى من Supabase…';
  try {
    const patients = await listAllPatientsForAssignedBranch({ branchId });
    renderCloudPatients(patients, host);
    dispatchCloudPatientsToLocal(branchId, patients);
    status(`تم تحميل ${patients.length} سجلًا سحابيًا. جارٍ تفعيل متابعة التغييرات لهذا الفرع.`);
    patientRealtimeUnsubscribe = await watchPatientsForAssignedBranch({
      branchId,
      onChange: () => refreshPatientsAfterRealtime(branchId),
      onStatus: state => {
        if (state === 'SUBSCRIBED') status('المتابعة اللحظية لمرضى هذا الفرع متصلة.');
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') status('المتابعة اللحظية غير متاحة حاليًا؛ استخدم زر تحميل المرضى للتحديث اليدوي.');
      }
    });
  } catch (e) {
    host.textContent = 'تعذر تحميل/متابعة المرضى: ' + (e.message || 'خطأ غير معروف');
    status('راجع صلاحيات الحساب وسياسات RLS وإعدادات Realtime في Supabase.');
  }
}
function renderCloudPatients(patients, host) {
  host.innerHTML = patients.length ? patients.map(p => `<div class="cloud-row"><b>${escapeHtml(p.name)}</b><div>${escapeHtml(p.no)} · ${escapeHtml(p.ph)} · ${escapeHtml(p.st)}</div></div>`).join('') : 'لا توجد سجلات مرضى في هذا الفرع بعد.';
}
async function refreshPatientsAfterRealtime(branchId) {
  if (patientRefreshInFlight || $('dcos-cloud-workspace').hidden || $('dcos-cloud-branch')?.value !== branchId) return;
  patientRefreshInFlight = true;
  try {
    const patients = await listAllPatientsForAssignedBranch({ branchId });
    if ($('dcos-cloud-branch')?.value === branchId) {
      renderCloudPatients(patients, $('dcos-cloud-patients'));
      dispatchCloudPatientsToLocal(branchId, patients);
    }
    status('تم تحديث قائمة المرضى بعد وصول تغيير من السحابة.');
  } catch (e) {
    status('وصل إشعار تغيير، لكن تعذر إعادة تحميل القائمة: ' + (e.message || 'خطأ غير معروف'));
  } finally { patientRefreshInFlight = false; }
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(value) { return escapeHtml(value); }



// Local patient demographic outbox. Clinical, appointment and financial fields
// are intentionally excluded. Failed/network-offline writes remain queued.
function getSavedBranchConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(BRANCH_MAP_KEY) || 'null');
    if (saved?.clinicId && saved?.map && typeof saved.map === 'object') return saved;
  } catch {}
  return null;
}
function getSavedBranchMap() {
  const saved = getSavedBranchConfig();
  if (saved?.clinicId === activeMembership?.clinic_id) return saved.map;
  return {};
}

window.addEventListener('dcos:patient-saved', event => {
  const patient = event.detail;
  if (!patient || !patient.id || !patient.localBranchId) return;
  const saved = getSavedBranchConfig();
  if (!saved?.map?.[String(patient.localBranchId)]) return; // no outbox until owner opt-in
  if (activeMembership && saved.clinicId !== activeMembership.clinic_id) return;
  enqueueLocalPatientForSync({ ...patient, clinicId: saved.clinicId });
});
window.addEventListener('online', () => flushPatientSyncQueue());
function readPatientQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(PATIENT_QUEUE_KEY) || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch { return []; }
}
function enqueueLocalPatientForSync(patient) {
  const queue = readPatientQueue();
  const item = { ...patient, clinicId: patient.clinicId || activeMembership?.clinic_id || '', queuedAt: new Date().toISOString() };
  const index = queue.findIndex(x => x.id === item.id && x.localBranchId === item.localBranchId);
  if (index >= 0) queue[index] = item;
  else queue.push(item);
  localStorage.setItem(PATIENT_QUEUE_KEY, JSON.stringify(queue));
  flushPatientSyncQueue();
}
async function flushPatientSyncQueue() {
  if (patientQueueFlushInFlight || !navigator.onLine || !activeMembership) return;
  patientQueueFlushInFlight = true;
  const queue = readPatientQueue();
  const initialQueueByKey = new Map(queue.map(item => [String(item.clinicId)+'::'+String(item.localBranchId)+'::'+String(item.id), item]));
  const remaining = [];
  const branchMap = getSavedBranchMap();
  let synced = 0, blocked = 0;
  const conflicts = (() => { try { const x = JSON.parse(localStorage.getItem(PATIENT_CONFLICTS_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } })();
  try {
    for (const item of queue) {
      if (!item.clinicId || item.clinicId !== activeMembership.clinic_id) { remaining.push(item); continue; }
      const branchId = branchMap[String(item.localBranchId)];
      if (!branchId) { remaining.push(item); blocked++; continue; }
      try {
        let remote;
        if (item.remoteId) {
          if (!item.cloudUpdatedAt) throw new Error('رابط المريض السحابي بلا إصدار معروف؛ يلزم تحديث الربط قبل الكتابة.');
          remote = await updatePatientInAssignedBranch({ branchId, patientId: item.remoteId, patient: item, expectedUpdatedAt: item.cloudUpdatedAt });
        } else {
          remote = await upsertPatientInAssignedBranch({ branchId, localId: item.id, fileNo: item.no, patient: item, expectedUpdatedAt: item.cloudUpdatedAt });
        }
        window.dispatchEvent(new CustomEvent('dcos:cloud-patient-links', { detail: { links: [{
          localId: item.id, remoteId: remote.remoteId, remoteBranchId: branchId,
          remoteUpdatedAt: remote.remoteUpdatedAt, localBranchId: item.localBranchId
        }] } }));
        synced++;
      } catch (error) {
        if (/رقم الملف مستخدم بالفعل|تغير سجل المريض على جهاز آخر|بلا إصدار معروف|إصدار المزامنة غير معروف/.test(error?.message || '')) {
          conflicts.push({ clinicId: item.clinicId, id: item.id, no: item.no, localBranchId: item.localBranchId, reason: error.message, detectedAt: new Date().toISOString() });
          window.dispatchEvent(new CustomEvent('dcos:patient-sync-conflict', { detail: { localId: item.id, localBranchId: item.localBranchId, reason: error.message } }));
          blocked++;
        } else remaining.push(item);
      }
    }
    const finalQueueByKey = new Map(remaining.map(item => [String(item.clinicId)+'::'+String(item.localBranchId)+'::'+String(item.id), item]));
    // Preserve saves that arrived while an earlier network request was awaiting.
    for (const latest of readPatientQueue()) {
      const key = String(latest.clinicId)+'::'+String(latest.localBranchId)+'::'+String(latest.id);
      const initial = initialQueueByKey.get(key);
      if (!initial || latest.queuedAt !== initial.queuedAt) finalQueueByKey.set(key, latest);
    }
    localStorage.setItem(PATIENT_QUEUE_KEY, JSON.stringify([...finalQueueByKey.values()]));
    localStorage.setItem(PATIENT_CONFLICTS_KEY, JSON.stringify(conflicts));
    if (synced || blocked) status((synced ? 'تمت مزامنة ' + synced + ' سجل مريض أساسي. ' : '') + (blocked ? 'تم إيقاف ' + blocked + ' سجلات متعارضة ونقلها لقائمة المراجعة؛ لم يتم استبدال أي مريض موجود.' : ''));
  } finally {
    patientQueueFlushInFlight = false;
  }
}

// Main-app username login bridge. Keep credentials in Supabase Auth only; never persist them locally.
window.DCOS_CLOUD_AUTH = {
  async login(username, password) {
    await signInWithUsername(username, password);
    try {
      const result = await getCurrentClinicMembership();
      if (!result?.membership) throw new Error('الحساب غير مرتبط بعضوية عيادة نشطة.');
      const membership = result.membership;
      const branches = await listAssignedRemoteBranches(membership.clinic_id);
      if (membership.role !== 'owner' && !branches.length) throw new Error('لا يوجد فرع مسند لهذا الحساب. راجع مالك العيادة.');
      activeMembership = membership;
      activeBranches = branches;
      const savedMap = getSavedBranchMap();
      const mappedBranches = branches.map(branch => ({ ...branch, localBranchId: Object.keys(savedMap).find(localId => savedMap[localId] === branch.id) || '' }));
      return { userId: result.session.user.id, role: membership.role, clinicId: membership.clinic_id, branches: mappedBranches };
    } catch (error) {
      await signOutSupabase().catch(() => {});
      throw error;
    }
  },
  async logout() {
    activeMembership = null;
    activeBranches = [];
    await signOutSupabase();
  }
};

restoreConfig();
try {
  const savedConfig = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  const embeddedConfig = window.DCOS_SUPABASE_CONFIG;
  const configured = embeddedConfig?.url && embeddedConfig?.publishableKey ? embeddedConfig : savedConfig;
  if (configured?.url && configured?.publishableKey) {
    configureSupabase({ url: configured.url, publishableKey: configured.publishableKey });
    (async () => {
      try {
        const { data, error } = await getSupabaseClient().auth.getSession();
        if (error) throw error;
        if (data?.session) {
          await loadWorkspace();
          flushPatientSyncQueue();
        }
      } catch (e) {
        status(e.message || 'تعذر استعادة جلسة المزامنة السحابية.');
      }
    })();
  }
} catch (e) { status(e.message || 'تعذر تهيئة الاتصال السحابي.'); }
