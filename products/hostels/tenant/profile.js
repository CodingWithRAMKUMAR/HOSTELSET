import { normalizeBloodGroup } from '../../../lib/bloodGroups';
import {
  uploadProfilePhotoWithSignedUrl,
  validateProfilePhotoFile,
} from '../../../lib/profilePhotos';

export function tenantProfileFormFromTenant(tenant = {}) {
  return {
    name: tenant?.name || '',
    phone: tenant?.phone || '',
    email: tenant?.email || '',
    blood_group: tenant?.blood_group || '',
  };
}

export function validateTenantProfileForm(profileForm = {}) {
  if (!profileForm.name) return { valid: false, message: 'Name is required' };
  if (!normalizeBloodGroup(profileForm.blood_group)) return { valid: false, message: 'Blood group is required' };
  return { valid: true, bloodGroup: normalizeBloodGroup(profileForm.blood_group) };
}

export function validateTenantProfilePhotoFile(file) {
  return validateProfilePhotoFile(file);
}

export async function updateTenantProfile(supabaseClient, profileForm = {}) {
  const validation = validateTenantProfileForm(profileForm);
  if (!validation.valid) throw new Error(validation.message);

  const { error } = await supabaseClient.rpc('update_tenant_profile', {
    p_name: profileForm.name,
    p_phone: profileForm.phone,
    p_blood_group: validation.bloodGroup,
  });
  if (error) throw error;

  return validation;
}

export async function uploadTenantProfilePhoto(supabaseClient, fetcher, file) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const uploadedPath = await uploadProfilePhotoWithSignedUrl('/api/tenant/profile-photo', file);
  const updateResponse = await fetcher('/api/tenant/profile-photo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ action: 'update', path: uploadedPath }),
  });
  const updated = await updateResponse.json().catch(() => ({}));
  if (!updateResponse.ok) throw new Error(updated.error || 'Could not update profile photo');
  return { uploadedPath, signedUrl: updated.signedUrl || null };
}

export function tenantProfileStatePatch(profileForm = {}, validation = {}, photo = null) {
  return {
    name: profileForm.name,
    phone: profileForm.phone,
    blood_group: validation.bloodGroup || normalizeBloodGroup(profileForm.blood_group),
    ...(photo?.uploadedPath ? { profile_photo_path: photo.uploadedPath } : {}),
  };
}

export function tenantProfilePhotoCacheKey(userScope, tenantData = {}) {
  return `${userScope || 'anonymous'}:${tenantData.id}:${tenantData.property_id}:${tenantData.profile_photo_path || ''}:${tenantData.updated_at || tenantData.move_in_date || ''}`;
}

export async function loadTenantProfilePhotoUrl(supabaseClient, fetcher, tenantData, cache) {
  if (!tenantData?.id || !tenantData?.property_id) {
    return null;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  const cacheKey = tenantProfilePhotoCacheKey(session?.user?.id || 'anonymous', tenantData);
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const response = await fetcher('/api/tenant/profile-photo-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({}),
  });

  if (response.status === 404) {
    cache?.set(cacheKey, null);
    return null;
  }
  if (!response.ok) throw new Error('Profile photo unavailable');

  const data = await response.json();
  const url = data?.signedUrl || null;
  cache?.set(cacheKey, url);
  return url;
}
