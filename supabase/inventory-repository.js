/*
 * Inventory repository — metadata plus immutable, retry-safe stock movements.
 * Item quantities are never overwritten by a sync upsert; they change only
 * through the atomic, idempotent movement RPC.
 */
import { getSupabaseClient, getCurrentSupabaseSession } from './auth-adapter.js';

const ITEM_FIELDS = 'id,clinic_id,branch_id,source_local_id,supplier_id,sku,name,unit,quantity,min_quantity,unit_cost,active,created_by,created_at,updated_at';
const MOVEMENT_FIELDS = 'id,clinic_id,branch_id,item_id,source_local_id,movement_type,quantity_delta,unit_cost,reference,notes,created_by,created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
function required(value,label){if(value===undefined||value===null||String(value).trim()==='')throw new Error(label+' is required.');return String(value).trim();}
function uuid(value,label){const id=required(value,label);if(!UUID.test(id))throw new Error(label+' must be a remote UUID.');return id;}
function nonnegative(value,label){const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(label+' must be zero or greater.');return n;}
async function actorId(){const session=await getCurrentSupabaseSession();if(!session?.user?.id)throw new Error('Sign in before accessing inventory.');return session.user.id;}

export async function listRemoteInventoryItems({clinicId,branchId,limit=500}={}){
  uuid(clinicId,'Remote clinic ID');uuid(branchId,'Remote branch ID');
  const {data,error}=await getSupabaseClient().from('clinic_inventory_items').select(ITEM_FIELDS)
    .eq('clinic_id',clinicId).eq('branch_id',branchId).order('name',{ascending:true})
    .limit(Math.max(1,Math.min(Number(limit)||500,1000)));
  if(error)throw error;return data||[];
}
export async function listRemoteInventoryMovements({clinicId,branchId,itemId,limit=500}={}){
  uuid(clinicId,'Remote clinic ID');uuid(branchId,'Remote branch ID');
  let query=getSupabaseClient().from('clinic_inventory_movements').select(MOVEMENT_FIELDS)
    .eq('clinic_id',clinicId).eq('branch_id',branchId).order('created_at',{ascending:false})
    .limit(Math.max(1,Math.min(Number(limit)||500,1000)));
  if(itemId)query=query.eq('item_id',uuid(itemId,'Remote inventory item ID'));
  const {data,error}=await query;if(error)throw error;return data||[];
}
/** Creates/updates item metadata by stable local ID. Stock quantity is always ledger-derived. */
export async function upsertRemoteInventoryItemFromLocal({clinicId,branchId,localId,item,expectedUpdatedAt}={}){
  uuid(clinicId,'Remote clinic ID');uuid(branchId,'Remote branch ID');
  const stableId=required(localId,'Local inventory item ID');const actor=await actorId();
  if(!item||typeof item!=='object')throw new Error('Inventory item details are required.');
  const payload={
    supplier_id:item.supplier_id||null,
    sku:String(item.sku||'').trim().slice(0,100),
    name:required(item.name,'Inventory item name').slice(0,200),
    unit:String(item.unit||'piece').trim().slice(0,40),
    min_quantity:nonnegative(item.min_quantity??0,'Minimum quantity'),
    unit_cost:nonnegative(item.unit_cost??0,'Unit cost'),
    active:item.active!==false
  };
  const client=getSupabaseClient();
  const existing=await client.from('clinic_inventory_items').select('id')
    .eq('clinic_id',clinicId).eq('branch_id',branchId).eq('source_local_id',stableId).maybeSingle();
  if(existing.error)throw existing.error;
  let result;
  if(existing.data?.id){
    if(!expectedUpdatedAt)throw new Error('Inventory item version is unknown; refresh before updating.');
    result=await client.from('clinic_inventory_items').update(payload)
      .eq('id',existing.data.id).eq('clinic_id',clinicId).eq('branch_id',branchId)
      .eq('updated_at',expectedUpdatedAt).select(ITEM_FIELDS).single();
    if(result.error?.code==='PGRST116')throw new Error('Inventory item changed on another device. Sync stopped for review.');
  }else{
    result=await client.from('clinic_inventory_items').insert({
      clinic_id:clinicId,branch_id:branchId,source_local_id:stableId,
      created_by:actor,quantity:0,...payload
    }).select(ITEM_FIELDS).single();
  }
  if(result.error)throw result.error;return result.data;
}
/** Each local movement ID can affect stock only once, even after offline retries. */
export async function postRemoteInventoryMovementFromLocal({
  itemId,localMovementId,movementType,quantityDelta,unitCost=0,reference='',notes=''
}={}){
  uuid(itemId,'Remote inventory item ID');
  const sourceId=required(localMovementId,'Local inventory movement ID');
  const delta=Number(quantityDelta);
  if(!Number.isFinite(delta)||delta===0)throw new Error('Movement quantity must be non-zero.');
  const cost=nonnegative(unitCost,'Movement unit cost');
  const {data,error}=await getSupabaseClient().rpc('post_inventory_movement_idempotent',{
    p_item_id:itemId,p_source_local_id:sourceId,p_movement_type:movementType,
    p_quantity_delta:delta,p_unit_cost:cost,p_reference:String(reference||''),
    p_notes:String(notes||'')
  });
  if(error)throw error;return Array.isArray(data)?data[0]:data;
}
