import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,anonKey=Deno.env.get("SUPABASE_ANON_KEY")||"";
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const DEFAULT_PERMISSIONS:Record<string,string[]>={manager:["pv","pa","pe","pr","ex","au","br","aw"],dentist:["pv","pa","pe","aw"],nurse:["pv","pa","pe"],reception:["pv","pa","pe","aw"],accountant:["pv","ex"],readonly:["pv"],invmgr:["pv","im","iv"]};
function usernameOf(v:unknown){const u=String(v??"").trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(u))throw new Error("INVALID_USERNAME");return u;}
async function emailFor(u:string){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(u));return "u-"+[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")+"@accounts.dentalclinic.invalid";}
function passwordOf(v:unknown){const p=String(v??"");if(p.length<8||p.length>128)throw new Error("INVALID_PASSWORD");return p;}
async function createIdentity(u:string,p:string){const {data,error}=await admin.auth.admin.createUser({email:await emailFor(u),password:p,email_confirm:true,user_metadata:{username:u}});if(error)throw new Error(error.message);const {error:mapError}=await admin.from("clinic_usernames").insert({user_id:data.user.id,username:u});if(mapError){await admin.auth.admin.deleteUser(data.user.id);throw mapError;}return data.user;}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const b=await req.json(),action=String(b?.action||"");
  if(action==="login"){
   const u=usernameOf(b.username),p=passwordOf(b.password);
   const {data:row,error:lookup}=await admin.from("clinic_usernames").select("user_id").eq("username",u).maybeSingle();
   if(lookup||!row)return json({error:"INVALID_CREDENTIALS"},401);
   const {data,error}=await authClient.auth.signInWithPassword({email:await emailFor(u),password:p});
   if(error||!data.session)return json({error:"INVALID_CREDENTIALS"},401);
   return json({access_token:data.session.access_token,refresh_token:data.session.refresh_token,expires_in:data.session.expires_in,token_type:data.session.token_type,user:{id:data.user.id,username:u}});
  }
  if(action==="create_staff"){
   const token=(req.headers.get("Authorization")||"").startsWith("Bearer ")?(req.headers.get("Authorization")||"").slice(7):(req.headers.get("Authorization")||"");
   const {data:caller,error:authError}=await admin.auth.getUser(token);
   if(authError||!caller.user)return json({error:"AUTH_REQUIRED"},401);
   const {data:members,error:memberError}=await admin.from("clinic_members").select("clinic_id,role").eq("user_id",caller.user.id).eq("active",true);
   if(memberError)throw memberError;
   const owner=(members||[]).find(x=>x.role==="owner");if(!owner)return json({error:"OWNER_REQUIRED"},403);
   const u=usernameOf(b.username),p=passwordOf(b.password),role=String(b.role||"");
   if(!["manager","dentist","reception","accountant","readonly","invmgr","nurse"].includes(role))return json({error:"INVALID_ROLE"},400);
   const {data:branch,error:branchError}=await admin.from("clinic_branches").select("id").eq("id",String(b.branch_id||"")).eq("clinic_id",owner.clinic_id).eq("active",true).maybeSingle();
   if(branchError||!branch)return json({error:"BRANCH_NOT_AVAILABLE"},400);
   const newUser=await createIdentity(u,p);
   try{
    const {error:e1}=await admin.from("clinic_members").insert({clinic_id:owner.clinic_id,user_id:newUser.id,role,active:true,permissions:DEFAULT_PERMISSIONS[role]||[]});if(e1)throw e1;
    const {error:e2}=await admin.from("clinic_member_branches").insert({clinic_id:owner.clinic_id,user_id:newUser.id,branch_id:branch.id});if(e2)throw e2;
   }catch(e){await admin.auth.admin.deleteUser(newUser.id);throw e;}
   return json({ok:true,user_id:newUser.id,username:u,role,branch_id:branch.id});
  }
  if(action==="manage_permissions" || action==="list_staff"){
   const token=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
   const {data:caller,error:authError}=await admin.auth.getUser(token);
   if(authError||!caller.user)return json({error:"AUTH_REQUIRED"},401);
   const {data:owners,error:ownerError}=await admin.from("clinic_members").select("clinic_id,role").eq("user_id",caller.user.id).eq("active",true);
   if(ownerError)throw ownerError;
   const owner=(owners||[]).find(x=>x.role==="owner");if(!owner)return json({error:"OWNER_REQUIRED"},403);
   if(action==="list_staff"){
    const {data:members,error:e1}=await admin.from("clinic_members").select("user_id,role,active,permissions").eq("clinic_id",owner.clinic_id).neq("role","owner");
    if(e1)throw e1;
    const ids=(members||[]).map(x=>x.user_id);
    const {data:names,error:e2}=ids.length?await admin.from("clinic_usernames").select("user_id,username").in("user_id",ids):{data:[],error:null};
    if(e2)throw e2;
    return json({ok:true,staff:(members||[]).map(m=>({...m,username:(names||[]).find(n=>n.user_id===m.user_id)?.username||""}))});
   }
   const userId=String(b.user_id||"");
   const allowed=["pv","pa","pe","pr","ex","au","br","cl","mv","fv","lv","im","rp","pi","aw","iv"];
   const permissions=[...new Set(Array.isArray(b.permissions)?b.permissions.map(String):[])];
   if(!userId||permissions.some(x=>!allowed.includes(x)))return json({error:"INVALID_PERMISSIONS"},400);
   const {data:target,error:targetError}=await admin.from("clinic_members").select("user_id,role").eq("clinic_id",owner.clinic_id).eq("user_id",userId).neq("role","owner").maybeSingle();
   if(targetError)throw targetError;if(!target)return json({error:"STAFF_NOT_FOUND"},404);
   const {error:updateError}=await admin.from("clinic_members").update({permissions}).eq("clinic_id",owner.clinic_id).eq("user_id",userId);
   if(updateError)throw updateError;
   return json({ok:true,user_id:userId,permissions});
  }
  if(action==="provision_clinic"){
   const expected=Deno.env.get("CLINIC_PROVISIONING_KEY")||"",supplied=(req.headers.get("Authorization")||"").startsWith("Bearer ")?(req.headers.get("Authorization")||"").slice(7):(req.headers.get("Authorization")||"");
   if(!expected)return json({error:"PROVISIONING_NOT_CONFIGURED"},503);
   const a=new TextEncoder().encode(supplied),z=new TextEncoder().encode(expected);let diff=a.length^z.length;
   for(let i=0;i<Math.max(a.length,z.length);i++)diff|=(a[i]||0)^(z[i]||0);
   if(diff)return json({error:"FORBIDDEN"},403);
   const u=usernameOf(b.username),p=passwordOf(b.password),clinicName=String(b.clinic_name||"").trim(),branchName=String(b.branch_name||"الفرع الرئيسي").trim();
   if(!clinicName||clinicName.length>160||!branchName||branchName.length>160)return json({error:"INVALID_CLINIC"},400);
   const owner=await createIdentity(u,p);
   let createdClinicId:string|null=null;
   try{
    const {data:clinic,error:e1}=await admin.from("clinics").insert({name:clinicName,created_by:owner.id}).select("id").single();if(e1)throw e1;
    createdClinicId=clinic.id;
    const {error:e2}=await admin.from("clinic_members").insert({clinic_id:clinic.id,user_id:owner.id,role:"owner",active:true});if(e2)throw e2;
    const {data:branch,error:e3}=await admin.from("clinic_branches").insert({clinic_id:clinic.id,name:branchName}).select("id").single();if(e3)throw e3;
    const {error:e4}=await admin.from("clinic_member_branches").insert({clinic_id:clinic.id,user_id:owner.id,branch_id:branch.id});if(e4)throw e4;
    return json({ok:true,clinic_id:clinic.id,owner_id:owner.id,username:u,branch_id:branch.id});
   }catch(e){if(createdClinicId)await admin.from("clinics").delete().eq("id",createdClinicId);await admin.auth.admin.deleteUser(owner.id);throw e;}
  }
  return json({error:"UNKNOWN_ACTION"},400);
 }catch(e){const m=e instanceof Error?e.message:"INTERNAL_ERROR";return json({error:m},m==="INVALID_USERNAME"||m==="INVALID_PASSWORD"?400:500);}
});