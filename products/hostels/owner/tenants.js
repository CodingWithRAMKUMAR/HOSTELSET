import { cleanPhoneNumber } from '../../../lib/utils';

export const OWNER_TENANT_PROFILE_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const OWNER_TENANT_PROFILE_PHOTO_MAX_SIZE = 5 * 1024 * 1024;

export const OWNER_TENANT_INITIAL_FORM = Object.freeze({
  name: '',
  phone: '',
  email: '',
  blood_group: '',
  rent_amount: '',
  room_id: '',
  advance_amount: '0',
  joining_fee: '0',
  profile_photo_file: null,
});

export function createOwnerTenantFormDefaults() {
  return { ...OWNER_TENANT_INITIAL_FORM };
}

export function ownerTenantProfilePhotoIsValid(file) {
  return Boolean(file)
    && OWNER_TENANT_PROFILE_PHOTO_TYPES.includes(file.type)
    && file.size <= OWNER_TENANT_PROFILE_PHOTO_MAX_SIZE;
}

export function validateOwnerTenantBeforeSubmit(formData, rooms = []) {
  if (!formData.name || !formData.phone || !formData.email || !formData.blood_group || !formData.rent_amount || !formData.room_id) {
    return { valid: false, message: 'Please fill all required fields, including blood group' };
  }

  if (formData.profile_photo_file && !ownerTenantProfilePhotoIsValid(formData.profile_photo_file)) {
    return { valid: false, message: 'Profile photo must be a JPEG, PNG, or WEBP image under 5MB' };
  }

  const cleanPhone = cleanPhoneNumber(formData.phone);
  if (cleanPhone.length !== 10) {
    return { valid: false, message: 'Enter valid 10-digit phone number' };
  }

  const selectedRoom = rooms.find(room => room.id === formData.room_id);
  if (!selectedRoom) {
    return { valid: false, message: 'Selected room not found' };
  }

  if (selectedRoom.current_occupants >= selectedRoom.capacity) {
    return { valid: false, message: `Room ${selectedRoom.room_number} is full!` };
  }

  return { valid: true, cleanPhone, selectedRoom };
}

export function buildOwnerTenantRegistrationPayload(property, selectedRoom, formData, cleanPhone) {
  const tenantEmail = formData.email.trim().toLowerCase();
  const joiningFee = Number(formData.joining_fee || 0);
  const advanceMonths = Number(formData.advance_amount || 0);
  const monthlyRent = Number(formData.rent_amount);

  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0 || !Number.isInteger(advanceMonths) || advanceMonths < 0 || !Number.isFinite(joiningFee) || joiningFee < 0) {
    throw new Error('Enter valid rent, advance months, and joining fee');
  }

  return {
    propertyId: property.id,
    roomId: selectedRoom.id,
    name: formData.name,
    phone: cleanPhone,
    email: tenantEmail,
    bloodGroup: formData.blood_group,
    monthlyRent,
    advanceMonths,
    joiningFee,
  };
}

export async function registerOwnerTenant(supabaseClient, fetcher, property, selectedRoom, formData, cleanPhone) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Your session expired. Please log in again.');

  const response = await fetcher('/api/owner/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(buildOwnerTenantRegistrationPayload(property, selectedRoom, formData, cleanPhone)),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Tenant registration failed');

  return { result, session };
}

export async function uploadOwnerTenantProfilePhoto(supabaseClient, fetcher, tenantId, file, session) {
  if (!file) return null;
  if (!OWNER_TENANT_PROFILE_PHOTO_TYPES.includes(file.type)) throw new Error('Profile photo must be a JPEG, PNG, or WEBP image');
  if (file.size > OWNER_TENANT_PROFILE_PHOTO_MAX_SIZE) throw new Error('Profile photo must be under 5MB');

  const preparedResponse = await fetcher('/api/owner/tenant-profile-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'upload-url', tenantId, contentType: file.type, size: file.size }),
  });
  const prepared = await preparedResponse.json().catch(() => ({}));
  if (!preparedResponse.ok) throw new Error(prepared.error || 'Unable to prepare profile photo upload');

  const { error: uploadError } = await supabaseClient.storage
    .from('tenant-documents')
    .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
  if (uploadError) throw new Error('Profile photo upload failed. Please try again.');

  const updateResponse = await fetcher('/api/owner/tenant-profile-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'update', tenantId, path: prepared.path }),
  });
  const updated = await updateResponse.json().catch(() => ({}));
  if (!updateResponse.ok) throw new Error(updated.error || 'Unable to save profile photo');

  return prepared.path;
}

export async function archiveOwnerTenant(supabaseClient, tenantId, reason) {
  const { data, error } = await supabaseClient.rpc('archive_tenant', {
    p_tenant_id: tenantId,
    p_reason: String(reason).trim(),
  });
  if (error) throw error;
  return data;
}

export async function convertReservedPrebookingForReleasedRoom(supabaseClient, fetcher, roomId) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  const response = await fetcher('/api/requests/convert-reserved-prebooking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ roomId }),
  });
  const conversion = await response.json().catch(() => ({}));
  return { response, conversion };
}
