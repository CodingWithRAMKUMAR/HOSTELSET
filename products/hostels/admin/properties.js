export const ADMIN_PROPERTY_ARCHIVE_DEFAULT_REASON = 'Admin archived property';
export const ADMIN_PROPERTY_RESTORE_DEFAULT_REASON = 'Admin restored property';

export function loadAdminProperties(supabaseClient) {
  return supabaseClient
    .from('properties')
    .select('*, users:owner_id(full_name, email, phone)')
    .order('created_at', { ascending: false });
}

export function archiveAdminProperty(supabaseClient, propertyId, reason) {
  return supabaseClient.rpc('archive_property', {
    p_property_id: propertyId,
    p_reason: reason.trim() || ADMIN_PROPERTY_ARCHIVE_DEFAULT_REASON,
  });
}

export function restoreAdminProperty(supabaseClient, propertyId, reason) {
  return supabaseClient.rpc('restore_property', {
    p_property_id: propertyId,
    p_reason: reason.trim() || ADMIN_PROPERTY_RESTORE_DEFAULT_REASON,
  });
}
