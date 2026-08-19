import { useState } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import {
  createOwnerTenantFormDefaults,
  registerOwnerTenant,
  uploadOwnerTenantProfilePhoto,
  validateOwnerTenantBeforeSubmit,
} from '../products/hostels/owner/tenants';

export function useOwnerTenants(property, rooms, tenants, setTenants, setStats, loadData) {
  const [formData, setFormData] = useState(createOwnerTenantFormDefaults);

  const addTenant = async (isSubmitting, setIsSubmitting) => {
    if (isSubmitting) return;
    const validation = validateOwnerTenantBeforeSubmit(formData, rooms);
    if (!validation.valid) { toast.error(validation.message); return; }
    setIsSubmitting(true);
    try {
      const { result, session } = await registerOwnerTenant(supabase, fetch, property, validation.selectedRoom, formData, validation.cleanPhone);
      if (formData.profile_photo_file && result.tenantId) {
        try {
          await uploadOwnerTenantProfilePhoto(supabase, fetch, result.tenantId, formData.profile_photo_file, session);
        } catch (photoError) {
          toast.error(`Tenant added, but profile photo was not saved: ${photoError.message}`);
        }
      }
      toast.success(result.emailSent ? `Tenant "${formData.name}" added and invited!` : `Tenant "${formData.name}" added. Password email can be resent.`);
      setFormData(createOwnerTenantFormDefaults());
      await loadData({ background: true, force: true, reason: 'add-tenant-reconciliation' });
    } catch (error) { toast.error('Failed to add tenant: ' + error.message); }
    finally { setIsSubmitting(false); }
  };

  return { tenants, formData, setFormData, addTenant };
}
