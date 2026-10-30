/*
 * Isolated Supabase cloud portal for the existing local-first app.
 * This first integration enables Supabase Auth, clinic/branch context and
 * branch-scoped patient reads. It does not upload or overwrite local D.
 */
import {
  configureSupabase, getSupabaseClient, signInWithPassword, signUpWithPassword, requestPasswordReset, updatePassword,
  signOutSupabase, getCurrentClinicMembership, listAssignedRemoteBranches
} from './auth-adapter.js';
import { listPatientsForAssignedBranch, listAllPatientsForAssignedBranch, watchPatientsForAssignedBranch, upsertPatientInAssignedBranch } from './patient-sync-service.js';
import { preparePatientImport, importNewPatients } from './patient-import-service.js';

const CONFIG_KEY = 'dcos_supabase_public_config_v1';
const BRANCH_MAP_KEY = 'dcos_supabase_branch_map_v1';
const PATIENT_QUEUE_KEY = 'dcos_patient_sync_queue_v1';
let activeMembership = null, activeBranches = [], localImportSnapshot = null, importBranchMap = null, importPreview = null, localBackupExported = false, backupExportStarted = false;
let recoveryListenerClient = null, patientRealtimeUnsubscribe = null, patientRefreshInFlight = false, patientQueueFlushInFlight = false;
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
#dcos-cloud-card input,#dcos-cloud-card select{width:100%;padding:9px;margin:4px 0 10px;border:1px solid var(--bd,#d8e2e0);border-radius:8px;background:var(--bg,#f3f6f5);color:inherit;font:inherit}
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
  <div style="display:flex;align-items:center;gap:10px;justify-content:space-between"><h2 id="dcos-cloud-title" style="margin:0">اتصال العيادة بـ Supabase</h2><button id="dcos-cloud-close" type="button">إغلاق</button></div>
  <p class="muted">هذه مساحة سحابية منفصلة عن قاعدة البيانات المحلية الحالية. تسجيل الدخول هنا لا يغيّر حسابات التطبيق المحلية، ولا يتم رفع أي بيانات محلية تلقائيًا.</p>
  <div id="dcos-cloud-config">
    <label>رابط مشروع Supabase<input id="dcos-sb-url" type="url" placeholder="https://xxxx.supabase.co" autocomplete="url"></label>
    <label>Publishable / anon key<input id="dcos-sb-key" type="password" placeholder="المفتاح العام للمشروع فقط" autocomplete="off"></label>
    <button class="primary" id="dcos-save-config" type="button">حفظ إعداد الاتصال</button>
    <p class="muted">لا تضع Service Role أو Secret Key هنا. الإعدادات تحفظ على هذا الجهاز فقط.</p>
  </div>
  <div id="dcos-cloud-auth">
    <label>البريد الإلكتروني<input id="dcos-sb-email" type="email" autocomplete="username"></label>
    <label>كلمة مرور Supabase<input id="dcos-sb-password" type="password" autocomplete="current-password"></label>
    <div class="cloud-actions"><button class="primary" id="dcos-sb-login" type="button">تسجيل الدخول السحابي</button><button id="dcos-sb-signup" type="button">إنشاء حساب دائم</button><button id="dcos-sb-reset" type="button">نسيت كلمة المرور؟</button><button id="dcos-sb-logout" type="button" hidden>تسجيل الخروج</button></div>
    <p class="muted">استخدم نفس البريد وكلمة المرور بعد إعادة تثبيت التطبيق. إذا كان تأكيد البريد مفعّلًا، افتح رسالة التأكيد أولًا. الحساب السحابي وحده لا ينقل بيانات المرضى المحلية تلقائيًا.</p>
  </div>
  <div id="dcos-password-recovery" hidden>
    <h3>تعيين كلمة مرور جديدة</h3>
    <label>كلمة المرور الجديدة<input id="dcos-new-password" type="password" minlength="8" autocomplete="new-password"></label>
    <button class="primary" id="dcos-save-new-password" type="button">حفظ كلمة المرور الجديدة</button>
  </div>
  <div id="dcos-cloud-workspace" hidden></div>
  <p id="dcos-cloud-status" class="muted" role="status" aria-live="polite"></p>
</section>`;
document.body.append(launch, panel);

const $ = id => document.getElementById(id);
const status = message => { $('dcos-cloud-status').textContent = message || ''; };
const open = () => panel.classList.add('open');
const close = () => panel.classList.remove('open');
function bindPasswordRecovery() {
  const client = getSupabaseClient();
  if (recoveryListenerClient === client) return;
  recoveryListenerClient = client;
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      $('dcos-password-recovery').hidden = false;
      $('dcos-cloud-auth').hidden = true;
      status('تم التحقق من رابط الاستعادة. أدخل كلمة مرور جديدة.');
      open();
    }
  });
}

launch.addEventListener('click', () => { open(); });

$('dcos-save-new-password').addEventListener('click', async () => {
  const button = $('dcos-save-new-password');
  try {
    button.disabled = true;
    await updatePassword($('dcos-new-password').value);
    $('dcos-new-password').value = '';
    $('dcos-password-recovery').hidden = true;
    $('dcos-cloud-auth').hidden = false;
    $('dcos-sb-logout').hidden = false;
    status('تم تحديث كلمة المرور. يمكنك تسجيل الدخول بها على أجهزتك الأخرى.');
  } catch (e) { status(e.message || 'تعذر تحديث كلمة المرور.'); }
  finally { button.disabled = false; }
});
$('dcos-cloud-close').addEventListener('click', close);
panel.addEventListener('click', e => { if (e.target === panel) close(); });

function restoreConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (c) { $('dcos-sb-url').value = c.url || ''; $('dcos-sb-key').value = c.publishableKey || ''; }
  } catch {}
}
function configure() {
  const url = $('dcos-sb-url').value.trim();
  const publishableKey = $('dcos-sb-key').value.trim();
  configureSupabase({ url, publishableKey });
  bindPasswordRecovery();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, publishableKey }));
}
$('dcos-save-config').addEventListener('click', () => {
  try { configure(); status('تم حفظ إعداد الاتصال على هذا الجهاز.'); }
  catch (e) { status(e.message || 'تعذر إعداد الاتصال.'); }
});
$('dcos-sb-login').addEventListener('click', async () => {
  try {
    configure();
    status('جارٍ تسجيل الدخول والتحقق من عضوية العيادة…');
    await signInWithPassword($('dcos-sb-email').value, $('dcos-sb-password').value);
    $('dcos-sb-password').value = '';
    $('dcos-sb-logout').hidden = false;
    await loadWorkspace();
    flushPatientSyncQueue();
  } catch (e) { status(e.message || 'فشل تسجيل الدخول.'); }
});
$('dcos-sb-signup').addEventListener('click', async () => {
  try {
    configure();
    status('جارٍ إنشاء الحساب السحابي…');
    const data = await signUpWithPassword($('dcos-sb-email').value, $('dcos-sb-password').value);
    $('dcos-sb-password').value = '';
    if (data.session) {
      $('dcos-sb-logout').hidden = false;
      await loadWorkspace();
      status('تم إنشاء الحساب وتسجيل الدخول. أنشئ العيادة السحابية إذا كان هذا حساب المالك الأول.');
    } else {
      status('تم إرسال رسالة تأكيد إلى البريد إن كان التأكيد مطلوبًا. افتح الرسالة، ثم ارجع وسجّل الدخول بنفس البيانات. لم تُرفع بيانات المرضى بعد.');
    }
  } catch (e) { status(e.message || 'تعذر إنشاء الحساب.'); }
});
$('dcos-sb-reset').addEventListener('click', async () => {
  try {
    configure();
    await requestPasswordReset($('dcos-sb-email').value);
    status('إذا كان البريد مسجلًا، ستصلك رسالة لإعادة تعيين كلمة المرور. افحص البريد الوارد والرسائل غير المرغوب فيها.');
  } catch (e) { status(e.message || 'تعذر إرسال رسالة استعادة كلمة المرور.'); }
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
  const host = $('dcos-cloud-workspace');
  host.hidden = false;
  host.innerHTML = '<p class="muted">جارٍ تحميل صلاحياتك والفروع المتاحة…</p>';
  const result = await getCurrentClinicMembership();
  if (!result) {
    host.innerHTML = `<h3>إنشاء عيادة سحابية جديدة</h3>
      <p class="muted">هذا الخيار ينشئ عيادة ومالكًا وفرعًا رئيسيًا في Supabase. استخدمه فقط إذا لم تكن عضوًا في عيادة موجودة.</p>
      <label>اسم العيادة<input id="dcos-new-clinic" maxlength="160"></label>
      <label>اسم الفرع الرئيسي<input id="dcos-new-branch" maxlength="160" value="الفرع الرئيسي"></label>
      <button class="primary" id="dcos-create-clinic" type="button">إنشاء العيادة السحابية</button>`;
    $('dcos-create-clinic').addEventListener('click', createClinic);
    status('لا توجد عضوية نشطة لهذا الحساب.');
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
  $('dcos-load-patients').addEventListener('click', loadPatients);
  $('dcos-cloud-branch').addEventListener('change', loadPatients);
  $('dcos-start-patient-import').addEventListener('click', beginPatientImport);
  status('الاتصال ناجح. تم التحقق من العضوية والفروع المسندة.');
  flushPatientSyncQueue();
}
async function createClinic() {
  try {
    const name = $('dcos-new-clinic').value.trim();
    const branchName = $('dcos-new-branch').value.trim();
    if (!name || !branchName) throw new Error('أدخل اسم العيادة والفرع.');
    status('جارٍ إنشاء العيادة والفرع…');
    const client = getSupabaseClient();
    const { data: clinicId, error } = await client.rpc('create_clinic_for_current_user', { p_name: name });
    if (error) throw error;
    const { data: branch, error: branchError } = await client.from('clinic_branches')
      .insert({ clinic_id: clinicId, name: branchName })
      .select('id').single();
    if (branchError) throw branchError;
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    const { error: assignmentError } = await client.from('clinic_member_branches').insert({
      clinic_id: clinicId, user_id: userData.user.id, branch_id: branch.id
    });
    if (assignmentError) throw assignmentError;
    status('تم إنشاء العيادة والفرع السحابي. جارٍ تحميل مساحة العمل…');
    await loadWorkspace();
  } catch (e) { status(e.message || 'تعذر إنشاء العيادة.'); }
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
    const remoteIds = [...new Set(Object.values(importBranchMap))];
    const lists = await Promise.all(remoteIds.map(branchId => listAllPatientsForAssignedBranch({branchId})));
    importPreview = preparePatientImport({localState:localImportSnapshot, clinicId:activeMembership.clinic_id, branchMap:importBranchMap, remotePatients:lists.flat()});
    const n = importPreview.counts;
    result.innerHTML = '<p><b>معاينة — بيانات المرضى الأساسية فقط</b></p><p>جديد: ' + n.new + ' · موجود: ' + n.duplicate + ' · تعارض: ' + n.conflict + ' · مستبعد: ' + n.blocked + '</p>' +
      '<p class="muted">لن يتم رفع السجلات العلاجية أو الأشعة أو الوصفات أو المدفوعات، ولن يتم تعديل مريض موجود.</p><ul>' +
      importPreview.rows.filter(x => x.state !== 'new').slice(0,30).map(x => '<li>' + escapeHtml(x.localId) + ' — ' + escapeHtml(x.reason) + '</li>').join('') + '</ul>' +
      (n.new ? '<button class="primary" id="dcos-confirm-patient-import" type="button">تأكيد رفع المرضى الجدد فقط</button>' : '<p>لا توجد سجلات جديدة جاهزة للرفع.</p>') + '<button id="dcos-enable-patient-sync" type="button">اعتماد ربط الفروع وتشغيل المزامنة التلقائية لبيانات المرضى الأساسية</button>';
    if (n.new) $('dcos-confirm-patient-import').addEventListener('click', confirmPatientImport);
    $('dcos-enable-patient-sync').addEventListener('click', enablePatientSync);
    status('اكتملت المعاينة دون كتابة أي بيانات على Supabase.');
  } catch (e) { result.textContent = e.message || 'تعذر إعداد المعاينة.'; }
}

function enablePatientSync() {
  if (!importBranchMap || !Object.keys(importBranchMap).length) return;
  if (!window.confirm('سيتم حفظ ربط الفروع على هذا الجهاز. بعد ذلك ستتم مزامنة بيانات المرضى الأساسية عند حفظها، مع إبقاء السجلات الطبية والمالية محلية. هل توافق؟')) return;
  localStorage.setItem(BRANCH_MAP_KEY, JSON.stringify(importBranchMap));
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
    result.textContent = 'انتهى الاستيراد: تمت إضافة ' + outcome.imported + '، وفشل ' + outcome.failed + '. تم حفظ ربط الفروع ومعرّفات السجلات الجديدة للمزامنة التالية.';
    status('انتهت محاولة استيراد المرضى. لم يتم رفع أي بيانات طبية فرعية.');
  } catch (e) { result.textContent = e.message || 'توقف الاستيراد بسبب خطأ.'; button.disabled = false; }
}

async function loadPatients() {
  const branchId = $('dcos-cloud-branch').value;
  const host = $('dcos-cloud-patients');
  if (!branchId) return;
  if (patientRealtimeUnsubscribe) { patientRealtimeUnsubscribe(); patientRealtimeUnsubscribe = null; }
  host.textContent = 'جارٍ تحميل سجلات المرضى من Supabase…';
  try {
    const patients = await listPatientsForAssignedBranch({ branchId, limit: 500 });
    renderCloudPatients(patients, host);
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
    const patients = await listPatientsForAssignedBranch({ branchId, limit: 500 });
    if ($('dcos-cloud-branch')?.value === branchId) renderCloudPatients(patients, $('dcos-cloud-patients'));
    status('تم تحديث قائمة المرضى بعد وصول تغيير من السحابة.');
  } catch (e) {
    status('وصل إشعار تغيير، لكن تعذر إعادة تحميل القائمة: ' + (e.message || 'خطأ غير معروف'));
  } finally { patientRefreshInFlight = false; }
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(value) { return escapeHtml(value); }



// Local patient demographic outbox. Clinical, appointment and financial fields
// are intentionally excluded. Failed/network-offline writes remain queued.
window.addEventListener('dcos:patient-saved', event => {
  const patient = event.detail;
  if (!patient || !patient.id || !patient.localBranchId) return;
  enqueueLocalPatientForSync(patient);
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
  const item = { ...patient, queuedAt: new Date().toISOString() };
  const index = queue.findIndex(x => x.id === item.id && x.localBranchId === item.localBranchId);
  if (index >= 0) queue[index] = item;
  else queue.push(item);
  localStorage.setItem(PATIENT_QUEUE_KEY, JSON.stringify(queue.slice(-1000)));
  flushPatientSyncQueue();
}
async function flushPatientSyncQueue() {
  if (patientQueueFlushInFlight || !navigator.onLine || !activeMembership) return;
  patientQueueFlushInFlight = true;
  let queue = readPatientQueue();
  const remaining = [];
  const branchMap = (() => {
    try { return JSON.parse(localStorage.getItem(BRANCH_MAP_KEY) || '{}'); }
    catch { return {}; }
  })();
  let synced = 0, blocked = 0;
  try {
    for (const item of queue) {
      const branchId = branchMap[String(item.localBranchId)];
      if (!branchId) { remaining.push(item); blocked++; continue; }
      try {
        await upsertPatientInAssignedBranch({
          branchId,
          localId: item.id,
          fileNo: item.no,
          patient: item
        });
        synced++;
      } catch (error) {
        remaining.push(item);
        if (/رقم الملف مستخدم بالفعل/.test(error?.message || '')) blocked++;
      }
    }
    localStorage.setItem(PATIENT_QUEUE_KEY, JSON.stringify(remaining));
    if (synced) status('تمت مزامنة ' + synced + ' سجل مريض أساسي إلى السحابة.');
    else if (blocked) status('توجد ' + blocked + ' سجلات تحتاج ربط فرع أو مراجعة تعارض قبل المزامنة.');
  } finally {
    patientQueueFlushInFlight = false;
  }
}

restoreConfig();
try {
  const configured = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  if (configured?.url && configured?.publishableKey) {
    configureSupabase({ url: configured.url, publishableKey: configured.publishableKey });
    bindPasswordRecovery();
  }
} catch (e) { status(e.message || 'تعذر تهيئة الاتصال السحابي.'); }
