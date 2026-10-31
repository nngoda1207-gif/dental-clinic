import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
let client=null, clientConfig=null;
async function functionError(error){try{const response=error?.context?.clone?.();if(response){const body=await response.json();if(body?.error)return String(body.error);}}catch{}return error?.message||'FUNCTION_ERROR';}
export function configureSupabase({url,publishableKey}) {
 if(!url||!publishableKey) throw new Error('Supabase URL and publishable key are required.');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error('Unexpected Supabase project URL.');
 if(client&&clientConfig?.url===url&&clientConfig?.publishableKey===publishableKey)return client;
 clientConfig={url,publishableKey};
 client=createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage,storageKey:'dcos_supabase_auth_v1'},global:{headers:{'X-Client-Info':'dental-clinic-os'}}});
 return client;
}
export function getSupabaseClient(){if(!client)throw new Error('Supabase client has not been configured.');return client;}
export async function signInWithUsername(username,password){
 const clean=String(username||'').trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(clean))throw new Error('اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا أو رقمًا.');
 const {data,error}=await getSupabaseClient().functions.invoke('clinic-auth',{body:{action:'login',username:clean,password:String(password||'')}});
 if(error){const detail=await functionError(error);const messages={INVALID_CREDENTIALS:'اسم المستخدم أو كلمة المرور غير صحيحين.',INVALID_USERNAME:'اسم المستخدم غير صحيح الصيغة. استخدم الاسم المسجل بدون مسافات مثل amr.amr.',INVALID_PASSWORD:'كلمة المرور يجب أن تكون من 8 إلى 128 حرفًا.'};throw new Error(messages[detail]||detail);}
 if(!data?.access_token||!data?.refresh_token)throw new Error(data?.error||'لم يرجع خادم الدخول جلسة صالحة.');
 const {data:sessionData,error:sessionError}=await getSupabaseClient().auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
 if(sessionError)throw sessionError;return sessionData;
}
export async function createClinicStaffAccount({username,password,role,branchId}){
 const {data,error}=await getSupabaseClient().functions.invoke('clinic-auth',{body:{action:'create_staff',username,password,role,branch_id:branchId}});
 if(error)throw new Error(await functionError(error));if(!data?.ok)throw new Error(data?.error||'تعذر إنشاء حساب الموظف.');return data;
}
export async function signOutSupabase(){const {error}=await getSupabaseClient().auth.signOut();if(error)throw error;}
export async function getCurrentSupabaseSession(){const {data,error}=await getSupabaseClient().auth.getSession();if(error)throw error;return data.session;}
export async function getCurrentClinicMembership(){
 const supabase=getSupabaseClient(),session=await getCurrentSupabaseSession();if(!session?.user)return null;
 const {data,error}=await supabase.from('clinic_members').select('clinic_id,user_id,role,active,created_at').eq('user_id',session.user.id).eq('active',true).limit(2);
 if(error)throw error;if(!data?.length)return null;if(data.length>1)throw new Error('هذا الحساب مرتبط بأكثر من عيادة؛ يلزم تحديد العيادة.');
 return {session,membership:data[0]};
}
export async function listAssignedRemoteBranches(clinicId){
 const supabase=getSupabaseClient(),session=await getCurrentSupabaseSession();
 if(!session?.user?.id)throw new Error('يجب تسجيل الدخول أولًا.');
 if(typeof clinicId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(clinicId))throw new Error('معرّف العيادة غير صالح.');
 const {data:assignments,error:assignmentError}=await supabase.from('clinic_member_branches').select('branch_id').eq('clinic_id',clinicId).eq('user_id',session.user.id);
 if(assignmentError)throw assignmentError;const ids=[...new Set((assignments||[]).map(x=>x.branch_id).filter(Boolean))];if(!ids.length)return [];
 const {data,error}=await supabase.from('clinic_branches').select('id,name,address,phone,active').eq('clinic_id',clinicId).eq('active',true).in('id',ids).order('name',{ascending:true});
 if(error)throw error;return data||[];
}