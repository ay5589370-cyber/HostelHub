import { supabase } from "../lib/supabase";

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const inventoryMetrics = () => rpc("inventory_dashboard_metrics");
export const listAssets = (filters = {}) => rpc("inventory_list_assets", {
  p_search: filters.search || "", p_category: filters.category || "",
  p_status: filters.status || "", p_condition: filters.condition || "",
  p_hostel_id: filters.hostelId || null, p_page: filters.page || 0, p_page_size: filters.pageSize || 25,
});
export const registerAsset = (data) => rpc("inventory_register_asset", { p_data: data });
export const updateAsset = (id, data, reason) => rpc("inventory_update_asset", { p_id: id, p_data: data, p_reason: reason });
export const moveAsset = (id, hostelId, roomId, location, reason) => rpc("inventory_move_asset", { p_id: id, p_hostel_id: hostelId || null, p_room_id: roomId || null, p_location: location, p_reason: reason });
export const setAssetState = (id, condition, status, reason) => rpc("inventory_set_asset_state", { p_id: id, p_condition: condition, p_status: status, p_reason: reason });
export const assetHistory = (id) => rpc("inventory_asset_history", { p_asset_id: id });
export const maintenanceOptions = (search = "") => rpc("inventory_maintenance_options", { p_search: search, p_page: 0, p_page_size: 50 });
export const linkMaintenance = (assetId, taskId, notes = "") => rpc("inventory_link_maintenance", { p_asset_id: assetId, p_task_id: taskId, p_notes: notes });
export const listStock = (filters = {}) => rpc("inventory_list_stock_items", { p_search: filters.search || "", p_category: "", p_low_only: filters.lowOnly || false, p_page: filters.page || 0, p_page_size: filters.pageSize || 25 });
export const registerStockItem = (data) => rpc("inventory_register_stock_item", { p_data: data });
export const adjustStock = (itemId, type, quantity, reason) => rpc("inventory_stock_adjust", { p_item_id: itemId, p_type: type, p_quantity: quantity, p_reason: reason });
export const stockTransactions = (itemId = null) => rpc("inventory_list_stock_transactions", { p_item_id: itemId, p_page: 0, p_page_size: 50 });
export async function inventoryLocations() {
  const [{ data: hostels, error: hostelError }, { data: rooms, error: roomError }] = await Promise.all([
    supabase.from("hostels").select("id,name,block").eq("status", "active").order("name"),
    supabase.from("rooms").select("id,hostel_id,room_number,floor_number").order("room_number"),
  ]);
  if (hostelError) throw hostelError;
  if (roomError) throw roomError;
  return { hostels: hostels || [], rooms: rooms || [] };
}
