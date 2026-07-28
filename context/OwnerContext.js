import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { clearHostelSetSessionCache, getRestoredSession, supabase } from '../lib/supabase';
import { calculateMembershipStatus } from '../lib/utils';
import { enrichTenantRentStatus } from '../lib/tenantRentStatus';
import { isPendingRentPayment } from '../lib/rentDue';
import { cleanupRealtimeChannel, createRealtimeChannel, logRealtimeEvent, subscribeRealtimeChannel } from '../lib/realtime';
import toast from 'react-hot-toast';

const OwnerContext = createContext();
const PENDING_RENT_STATUSES = ['payment_pending', 'pending', 'pending_confirmation', 'pending_owner_verification'];
const NON_MONTHLY_PAYMENT_METHODS = new Set(['security_deposit', 'deposit', 'pre_booking', 'joining_fee', 'application_fee']);

const markOwnerDataPerf = (label, detail = '', startedAt = null) => {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetOwnerPerf') !== '1' || typeof performance === 'undefined') return;
  const elapsed = typeof startedAt === 'number' ? ` ${Math.round(performance.now() - startedAt)}ms` : '';
  console.info(`[OwnerData] ${label}${elapsed}${detail ? ` ${detail}` : ''}`);
};

const timedOwnerQuery = async (label, query) => {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : null;
  try {
    return await query;
  } finally {
    markOwnerDataPerf(label, '', startedAt);
  }
};

const normalizeLoadArgs = (isBackgroundOrOptions = false, preferredPropertyId = null, options = {}) => {
  if (isBackgroundOrOptions && typeof isBackgroundOrOptions === 'object') {
    return {
      isBackground: Boolean(isBackgroundOrOptions.background),
      preferredPropertyId: isBackgroundOrOptions.propertyId || null,
      force: Boolean(isBackgroundOrOptions.force),
      reason: isBackgroundOrOptions.reason || 'manual-refresh',
    };
  }
  const isBackground = Boolean(isBackgroundOrOptions);
  return {
    isBackground,
    preferredPropertyId,
    force: options.force ?? isBackground,
    reason: options.reason || (isBackground ? 'background-refresh' : preferredPropertyId ? 'property-change' : 'initial-auth'),
  };
};

const ownerLoadKey = (userId, propertyId) => `${userId || 'anonymous'}:${propertyId || 'auto'}`;

const upsertRecord = (records, record) => {
  if (!record?.id) return records;
  const index = records.findIndex(item => item.id === record.id);
  if (index === -1) return [record, ...records];
  return records.map(item => item.id === record.id ? { ...item, ...record } : item);
};

const removeRecord = (records, id) => id ? records.filter(item => item.id !== id) : records;
const summarizeRooms = (rows = []) => {
  const totalRooms = rows.length;
  const occupied = rows.filter(room => Number(room.current_occupants || 0) >= Number(room.capacity || 0)).length;
  return { totalRooms, occupied, vacant: totalRooms - occupied };
};
const summarizeOwnerRentStats = (rows = []) => ({
  pendingAmount: rows.reduce((sum, tenant) => sum + Math.max(Number(tenant.pending_amount || 0), 0), 0),
  overdueCount: rows.filter(tenant => tenant.rentSummary?.status === 'overdue' || tenant.dueStatus?.status === 'overdue').length,
  noticePeriodCount: rows.filter(tenant => tenant.status === 'notice_period').length,
  pendingPaymentCount: rows.filter(tenant => tenant.status === 'payment_pending').length,
});

export function OwnerProvider({ children }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [properties, setProperties] = useState([]);
  const [property, setProperty] = useState(null);
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [propertyImages, setPropertyImages] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [archivedTenants, setArchivedTenants] = useState([]);
  const [settings, setSettings] = useState({ joining_fee:0, advance_months:1, due_day:5, pre_booking_fee:3000, application_deposit:3000, upi_id:'', upi_phone:'' });
  const [stats, setStats] = useState({ totalRooms:0, occupied:0, vacant:0, totalCollected:0, depositCollected:0, pendingAmount:0, totalComplaints:0, pendingVacate:0, overdueCount:0, noticePeriodCount:0, pendingPaymentCount:0, pendingRentConfirmations:0, monthlyIncome:0 });
  const [membershipActive, setMembershipActive] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipStatus, setMembershipStatus] = useState('loading');
  const [membershipExpiry, setMembershipExpiry] = useState(null);
  const [pendingMembershipRequest, setPendingMembershipRequest] = useState(null);
  const [daysLeft, setDaysLeft] = useState(null);
  const [roomMonthlyIncome, setRoomMonthlyIncome] = useState({});
  const [paymentSeed, setPaymentSeed] = useState({ propertyId: null, pendingRentPayments: [], allPayments: [], version: 0 });
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const autoRefreshRef = useRef(null);
  const inFlightLoadRef = useRef(null);
  const lastLoadedKeyRef = useRef(null);
  const lastLoadedRequestKeyRef = useRef(null);
  const lastLoadedPropertyRef = useRef(null);
  const roomsRef = useRef([]);
  const tenantsRef = useRef([]);
  const archivedTenantsRef = useRef([]);
  const paymentSeedRef = useRef({
    propertyId: null,
    pendingRentPayments: [],
    allPayments: [],
    version: 0,
  });

  useEffect(() => { roomsRef.current = rooms; }, [rooms]);
  useEffect(() => { tenantsRef.current = tenants; }, [tenants]);
  useEffect(() => { archivedTenantsRef.current = archivedTenants; }, [archivedTenants]);
  useEffect(() => { paymentSeedRef.current = paymentSeed; }, [paymentSeed]);

  const updateMembershipFromProperty = (propertyData) => {
    const membership = calculateMembershipStatus(propertyData);
    setMembershipActive(membership.active);
    setMembershipStatus(membership.status);
    setMembershipExpiry(membership.expiryDate);
    setDaysLeft(membership.daysLeft);
  };

  const loadData = useCallback(async (isBackgroundOrOptions = false, legacyPreferredPropertyId = null, legacyOptions = {}) => {
    const { isBackground, preferredPropertyId, force, reason } = normalizeLoadArgs(isBackgroundOrOptions, legacyPreferredPropertyId, legacyOptions);
    const userId = localStorage.getItem('userId');
    const requestedPropertyId = preferredPropertyId || localStorage.getItem('ownerPropertyId') || property?.id || null;
    const requestKey = ownerLoadKey(userId, requestedPropertyId);
    markOwnerDataPerf('load-requested', `reason=${reason} key=${requestKey}${force ? ' force=true' : ''}`);

    const inFlight = inFlightLoadRef.current;
    const canJoinInFlight = inFlight
      && inFlight.userId === userId
      && (!preferredPropertyId || !inFlight.preferredPropertyId || inFlight.preferredPropertyId === preferredPropertyId);
    if (canJoinInFlight) {
      markOwnerDataPerf('load-joined-in-flight', `reason=${reason} key=${requestKey}`);
      return inFlight.promise;
    }

    if (!force && lastLoadedPropertyRef.current && (lastLoadedKeyRef.current === requestKey || lastLoadedRequestKeyRef.current === requestKey)) {
      markOwnerDataPerf('load-skipped-cached', `reason=${reason} key=${requestKey}`);
      return lastLoadedPropertyRef.current;
    }

    const runLoad = async () => {
      const loadStartedAt = typeof performance !== 'undefined' ? performance.now() : null;
      markOwnerDataPerf(isBackground ? 'background-refresh-network-start' : 'core-load-start', `reason=${reason} key=${requestKey}${force ? ' force=true' : ''}`);
      if (!isBackground) setLoading(true); else setIsRefreshing(true);
      try {
        const { data: propertyRows, error: propertiesError } = await timedOwnerQuery('properties', supabase.from('properties').select('*').eq('owner_id', userId).order('created_at'));
        if (propertiesError) throw propertiesError;
        const ownedProperties = propertyRows || [];
        setProperties(ownedProperties);
        const propertyData = ownedProperties.find(item => item.id === requestedPropertyId) || ownedProperties[0] || null;
        if (propertyData) {
          localStorage.setItem('ownerPropertyId', propertyData.id);
          setProperty(propertyData); setPropertyImages(propertyData.photos || []); updateMembershipFromProperty(propertyData);
          
          // Rooms, tenants, and payment summaries are independent after the property is known.
          const rentPaymentStatuses = ['success', ...PENDING_RENT_STATUSES];
          const paymentSelect = '*, tenants!inner(id, name, phone, email, room_id, property_id, profile_photo_path, rooms(room_number))';
          const [{ data: roomsData, error: roomsError }, { data: tenantsData, error: tenantsError }, { data: archivedData, error: archivedError }, rentPaymentsResult, pendingPaymentsResult, allPaymentsResult] = await Promise.all([
            timedOwnerQuery('rooms', supabase.from('rooms').select('*').eq('property_id', propertyData.id).order('room_number')),
            timedOwnerQuery('active-tenants', supabase.from('tenants').select('*').eq('property_id', propertyData.id).in('status', ['active', 'notice_period', 'payment_pending'])),
            timedOwnerQuery('archived-tenants', supabase.from('tenants').select('*, check_out_requests(expected_check_out, status, completed_at, created_at)').eq('property_id', propertyData.id).eq('status', 'inactive').order('archived_at', { ascending: false, nullsFirst: false })),
            timedOwnerQuery('rent-status-payments', supabase.from('payment_history').select('id, tenant_id, amount, payment_date, payment_method, status, tenants!inner(room_id, property_id)').in('status', rentPaymentStatuses).eq('tenants.property_id', propertyData.id)),
            timedOwnerQuery('pending-payments', supabase.from('payment_history').select(paymentSelect).in('status', PENDING_RENT_STATUSES).eq('tenants.property_id', propertyData.id).order('payment_date', { ascending: false })),
            timedOwnerQuery('payment-history', supabase.from('payment_history').select(paymentSelect).eq('tenants.property_id', propertyData.id).order('payment_date', { ascending: false }).limit(100)),
          ]);
          if (roomsError) throw roomsError;
          if (tenantsError) throw tenantsError;
          if (archivedError) throw archivedError;
          if (rentPaymentsResult.error) throw rentPaymentsResult.error;
          if (pendingPaymentsResult.error) throw pendingPaymentsResult.error;
          if (allPaymentsResult.error) throw allPaymentsResult.error;
          setRooms(roomsData || []);
          const total = roomsData?.length || 0; const occupied = roomsData?.filter(r => r.current_occupants >= r.capacity).length || 0; const vacant = total - occupied;
          const rentPaymentsForStatus = rentPaymentsResult.data || [];
          const paymentsByTenant = rentPaymentsForStatus.reduce((grouped, payment) => {
            if (!grouped.has(payment.tenant_id)) grouped.set(payment.tenant_id, []);
            grouped.get(payment.tenant_id).push(payment);
            return grouped;
          }, new Map());
          const tenantsWithRoomNumber = (tenantsData || []).map(t => {
            const room = roomsData?.find(r => r.id === t.room_id);
            const rentSummary = enrichTenantRentStatus(t, paymentsByTenant.get(t.id) || []);
            return { ...t, room_number: room ? room.room_number : 'N/A', dueStatus: rentSummary, rentSummary };
          });
          setTenants(tenantsWithRoomNumber);
          setArchivedTenants((archivedData || []).map(tenant => {
            const latestCheckout = [...(tenant.check_out_requests || [])].sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at))[0];
            return { ...tenant, room_number: roomsData?.find(room => room.id === tenant.room_id)?.room_number || 'N/A', checkout_date:tenant.notice_period_end || latestCheckout?.expected_check_out || null };
          }));
          const activeTenantIdSet = new Set((tenantsData || []).map(tenant => tenant.id));
          const pendingSeed = (pendingPaymentsResult.data || [])
            .filter(payment => activeTenantIdSet.has(payment.tenant_id))
            .filter(payment => !NON_MONTHLY_PAYMENT_METHODS.has(String(payment.payment_method || '').toLowerCase()));
          setPaymentSeed(current => ({
            propertyId: propertyData.id,
            pendingRentPayments: pendingSeed,
            allPayments: allPaymentsResult.data || [],
            version: current.version + 1,
          }));
          if (!isBackground) {
            markOwnerDataPerf('first-usable-data', `reason=${reason} key=${ownerLoadKey(userId, propertyData.id)}`, loadStartedAt);
            setLoading(false);
          }
          
          const pendingAmount = tenantsWithRoomNumber.reduce((sum, tenant) => sum + (tenant.rentSummary?.hasUnpaidRent ? Math.max(Number(tenant.rentSummary.dueAmount || 0), 0) : 0), 0);
          const overdueCount = tenantsWithRoomNumber.filter(t => t.dueStatus.status === 'overdue').length;
          const noticePeriodCount = tenantsWithRoomNumber.filter(t => t.status === 'notice_period').length;
          const pendingPaymentCount = tenantsWithRoomNumber.filter(t => t.status === 'payment_pending').length;
          const tenantIds = tenantsData?.map(t => t.id) || [];
          const now = new Date(); const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]; const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
          const [pendingResult, complaintResult, vacateResult] = await Promise.all([
            tenantIds.length
              ? supabase.from('payment_history').select('id, payment_method, status').in('status', ['payment_pending', 'pending', 'pending_confirmation', 'pending_owner_verification']).in('tenant_id', tenantIds)
              : Promise.resolve({ data: [] }),
            supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('property_id', propertyData.id).in('status', ['open', 'in_progress']),
            supabase.from('check_out_requests').select('*', { count: 'exact', head: true }).eq('property_id', propertyData.id).eq('status', 'pending'),
          ]);
          const successfulPayments = rentPaymentsForStatus.filter(payment => payment.status === 'success');
          const rentPayments = successfulPayments.filter(payment => !NON_MONTHLY_PAYMENT_METHODS.has(String(payment.payment_method || '').toLowerCase()));
          const depositPayments = successfulPayments.filter(payment => String(payment.payment_method || '').toLowerCase() === 'security_deposit');
          const totalCollected = rentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
          const depositCollected = depositPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
          const paymentsThisMonth = rentPayments.filter(payment => payment.payment_date >= startOfMonth && payment.payment_date <= endOfMonth);
          const monthlyIncome = paymentsThisMonth.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
          const incomeByRoom = paymentsThisMonth.reduce((result, payment) => {
            const roomId = payment.tenants?.room_id;
            if (roomId) result[roomId] = (result[roomId] || 0) + Number(payment.amount || 0);
            return result;
          }, {});
          setRoomMonthlyIncome(incomeByRoom);
          const pendingRentConfirmations = (pendingResult.data || []).filter(payment => !NON_MONTHLY_PAYMENT_METHODS.has(String(payment.payment_method || '').toLowerCase())).length;
          const complaintCount = complaintResult.count;
          const vacateCount = vacateResult.count;

          setStats({ totalRooms:total, occupied, vacant, totalCollected, depositCollected, pendingAmount, totalComplaints:complaintCount||0, pendingVacate:vacateCount||0, overdueCount, noticePeriodCount, pendingPaymentCount, pendingRentConfirmations, monthlyIncome });
          lastLoadedKeyRef.current = ownerLoadKey(userId, propertyData.id);
          lastLoadedRequestKeyRef.current = requestKey;
          lastLoadedPropertyRef.current = propertyData;
          markOwnerDataPerf(isBackground ? 'background-refresh-finish' : 'core-load-finish', `reason=${reason} key=${ownerLoadKey(userId, propertyData.id)}`, loadStartedAt);
          return propertyData;
        }
        if (isBackground) return null;
        setProperty(null); setRooms([]); setTenants([]); setArchivedTenants([]); setRoomMonthlyIncome({});
        setPaymentSeed(current => ({ ...current, propertyId: null, pendingRentPayments: [], allPayments: [], version: current.version + 1 }));
        lastLoadedKeyRef.current = null;
        lastLoadedRequestKeyRef.current = null;
        lastLoadedPropertyRef.current = null;
        return null;
      } catch (error) {
        console.error('Load error:', error);
        if (!isBackground) toast.error('Failed to load data: ' + error.message);
        return null;
      } finally {
        if (!isBackground) setLoading(false); else setIsRefreshing(false);
      }
    };

    const promise = runLoad();
    inFlightLoadRef.current = { userId, preferredPropertyId, key: requestKey, promise };
    try {
      return await promise;
    } finally {
      if (inFlightLoadRef.current?.promise === promise) inFlightLoadRef.current = null;
    }
  }, [property?.id]);

  const startAutoRefresh = () => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    autoRefreshRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') loadData({ background: true, force: true, reason: 'auto-refresh' });
    }, 120000);
  };

  // Auth and Init
  const checkAuthAndRedirect = async () => {
    const { data:{session}, error } = await getRestoredSession();
    const user = session?.user;
    if (error || !user) { router.replace('/login/owner'); return null; }
    const { data:userRecord, error:roleError } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (roleError || !userRecord) { router.replace('/login/owner'); return null; }
    return { user, role: userRecord.role };
  };

  const loadSettings = async (loadedProperty = null) => {
    try {
      const selectedProperty = loadedProperty || property;
      const userId = localStorage.getItem('userId');
      if (!selectedProperty?.id) return;
      const { data, error } = await supabase.from('owner_settings').select('*').eq('owner_id', userId).eq('property_id', selectedProperty.id).maybeSingle();
      if (error) throw error;
      if (data) setSettings({ joining_fee:data.joining_fee||0, advance_months:data.advance_months||1, due_day:data.due_day||5, pre_booking_fee:Number(data.pre_booking_fee) > 0 ? Number(data.pre_booking_fee) : 3000, application_deposit:Number(data.application_deposit) > 0 ? Number(data.application_deposit) : 3000, upi_id:data.upi_id||'', upi_phone:data.upi_phone||'' });
      else setSettings({ joining_fee:0, advance_months:1, due_day:5, pre_booking_fee:3000, application_deposit:3000, upi_id:selectedProperty.owner_upi_id||'', upi_phone:'' });
    } catch (error) { console.error('Error loading settings:', error); toast.error('Failed to load settings'); }
  };

  const loadOwnerProfile = async (ownerId = null) => {
    let userId = ownerId;
    if (!userId) {
      const { data: { session } } = await getRestoredSession({ retryDelay: 100 });
      userId = session?.user?.id;
    }
    if (!userId) return null;
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, phone, is_active')
      .eq('id', userId)
      .single();
    if (error) throw error;
    setOwnerProfile(data);
    return data;
  };

  const updateOwnerProfile = async ({ full_name, phone }) => {
    const name = full_name?.trim();
    const cleanPhone = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!name) throw new Error('Full name is required');
    if (cleanPhone.length !== 10) throw new Error('Enter a valid 10-digit phone number');

    const { data: { session } } = await getRestoredSession({ retryDelay: 100 });
    if (!session?.user) throw new Error('Please log in again');
    const { error } = await supabase
      .from('users')
      .update({ full_name: name, phone: cleanPhone })
      .eq('id', session.user.id);
    if (error) throw error;
    await supabase.auth.updateUser({ data: { full_name: name, phone: cleanPhone } });
    localStorage.setItem('userName', name);
    await loadOwnerProfile();
  };

  const loadMembershipRequest = async (ownerId = property?.owner_id, propertyId = property?.id) => {
    if (!ownerId || !propertyId) { setPendingMembershipRequest(null); return null; }
    const { data, error } = await supabase
      .from('membership_requests')
      .select('id, plan_id, amount, status, requested_at, admin_note')
      .eq('owner_id', ownerId)
      .eq('property_id', propertyId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    setPendingMembershipRequest(data || null);
    return data || null;
  };

  const saveSettings = async (newSettings) => {
    const userId = localStorage.getItem('userId');
    if (!property?.id) throw new Error('Select a property first');
    const { data: existing } = await supabase.from('owner_settings').select('id').eq('owner_id', userId).eq('property_id', property.id).maybeSingle();
    const updateData = { joining_fee:newSettings.joining_fee, advance_months:newSettings.advance_months, due_day:newSettings.due_day, pre_booking_fee:Number(newSettings.pre_booking_fee) > 0 ? Number(newSettings.pre_booking_fee) : 3000, application_deposit:Number(newSettings.application_deposit) > 0 ? Number(newSettings.application_deposit) : 3000, upi_id:newSettings.upi_id, upi_phone:newSettings.upi_phone, updated_at:new Date().toISOString() };
    let error;
    if (existing) { const { error: updateError } = await supabase.from('owner_settings').update(updateData).eq('id', existing.id); error = updateError; }
    else { const { error: insertError } = await supabase.from('owner_settings').insert({ owner_id:userId, property_id:property.id, ...updateData }); error = insertError; }
    if (error) throw error;
    if (property && newSettings.upi_id) await supabase.from('properties').update({ owner_upi_id:newSettings.upi_id }).eq('id', property.id);
    setSettings(newSettings); await loadData({ background: true, force: true, reason: 'settings-save-reconciliation' });
  };

  const selectProperty = async (propertyId) => {
    if (!propertyId || propertyId === property?.id) return;
    localStorage.setItem('ownerPropertyId', propertyId);
    setLoading(true);
    setProperty(null); setRooms([]); setTenants([]); setArchivedTenants([]); setRoomMonthlyIncome({});
    setPaymentSeed(current => ({ ...current, propertyId, pendingRentPayments: [], allPayments: [], version: current.version + 1 }));
    setPendingMembershipRequest(null);
    const loadedProperty = await loadData({ propertyId, force: true, reason: 'property-change' });
    if (loadedProperty) {
      await Promise.all([
        loadSettings(loadedProperty),
        loadMembershipRequest(loadedProperty.owner_id, loadedProperty.id),
      ]);
    }
  };

  const requestMembership = async (planId, amount) => {
    if (!property?.id) {
      toast.error('Register a property before requesting membership');
      return false;
    }
    if (pendingMembershipRequest) {
      toast('Your membership request is already waiting for admin approval.', { icon: 'âŒ›' });
      return false;
    }
    setMembershipLoading(true);
    try {
      const { data: { session } } = await getRestoredSession({ retryDelay: 100 });
      if (!session) throw new Error('Please log in again');
      const { data, error } = await supabase.from('membership_requests').insert({
        owner_id: session.user.id,
        property_id: property.id,
        plan_id: planId,
        amount,
        status: 'pending',
      }).select('id, plan_id, amount, status, requested_at, admin_note').single();
      if (error) throw error;
      setPendingMembershipRequest(data);
      toast.success('Membership request sent to the admin.');
      return true;
    } catch (error) {
      console.error('Membership request error:', error);
      toast.error(error.code === '23505' ? 'A membership request is already pending.' : 'Failed to send membership request: ' + error.message);
      return false;
    }
    finally { setMembershipLoading(false); }
  };

  const patchRoomRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id) return;
    if (payload.eventType === 'DELETE') {
      setRooms(current => {
        const next = removeRecord(current, row.id);
        setStats(prev => ({ ...prev, ...summarizeRooms(next) }));
        return next;
      });
      markOwnerDataPerf('realtime-local-patch', `table=rooms action=delete id=${row.id}`);
      return;
    }
    if (row.property_id !== property?.id) return;
    setRooms(current => {
      const next = upsertRecord(current, row);
      setStats(prev => ({ ...prev, ...summarizeRooms(next) }));
      return next;
    });
    markOwnerDataPerf('realtime-local-patch', `table=rooms action=${String(payload.eventType || '').toLowerCase()} id=${row.id}`);
  }, [property?.id]);

  const patchTenantRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id) return;

    const activeStatuses = new Set(['active', 'notice_period', 'payment_pending']);

    const existingTenant =
      tenantsRef.current.find(item => item.id === row.id) ||
      archivedTenantsRef.current.find(item => item.id === row.id) ||
      null;

    const lifecycleChanged =
      payload.eventType === 'DELETE' ||
      existingTenant?.room_id !== row.room_id ||
      existingTenant?.property_id !== row.property_id ||
      existingTenant?.status !== row.status ||
      existingTenant?.notice_period_end !== row.notice_period_end ||
      existingTenant?.archived_at !== row.archived_at ||
      existingTenant?.vacated_at !== row.vacated_at;

    const reconcileTenantLifecycle = () => {
      if (!lifecycleChanged) return;

      void loadData({
        background: true,
        force: true,
        propertyId: property?.id,
        reason: 'tenant-lifecycle-realtime-change',
      });
    };

    if (
      payload.eventType === 'DELETE' ||
      row.status === 'inactive' ||
      row.status === 'archived'
    ) {
      setTenants(current => {
        const next = removeRecord(current, row.id);

        setStats(prev => ({
          ...prev,
          noticePeriodCount: next.filter(
            tenant => tenant.status === 'notice_period'
          ).length,
          pendingPaymentCount: next.filter(
            tenant => tenant.status === 'payment_pending'
          ).length,
        }));

        return next;
      });

      markOwnerDataPerf(
        'realtime-local-patch',
        `table=tenants action=remove id=${row.id}${lifecycleChanged ? ' full-refresh=true' : ''}`,
      );

      reconcileTenantLifecycle();
      return;
    }

    if (row.property_id !== property?.id || !activeStatuses.has(row.status)) {
      reconcileTenantLifecycle();
      return;
    }

    setTenants(current => {
      const existing = current.find(item => item.id === row.id);
      const room = roomsRef.current.find(item => item.id === row.room_id);

      const mergedTenant = {
        ...(existing || {}),
        ...row,
        room_number:
          room?.room_number ||
          existing?.room_number ||
          'N/A',
      };

      const tenantPayments =
        paymentSeedRef.current?.allPayments?.filter(
          payment => payment.tenant_id === row.id
        ) || [];

      const {
        rentSummary: previousRentSummary,
        dueStatus: previousDueStatus,
        ...tenantForRentCalculation
      } = mergedTenant;

      const rentSummary = enrichTenantRentStatus(
        tenantForRentCalculation,
        tenantPayments
      );

      const merged = {
        ...mergedTenant,
        dueStatus: rentSummary,
        rentSummary,
      };

      const next = upsertRecord(current, merged);

      setStats(prev => ({
        ...prev,
        noticePeriodCount: next.filter(
          tenant => tenant.status === 'notice_period'
        ).length,
        pendingPaymentCount: next.filter(
          tenant => tenant.status === 'payment_pending'
        ).length,
      }));

      return next;
    });

    markOwnerDataPerf(
      'realtime-local-patch',
      `table=tenants action=${String(payload.eventType || '').toLowerCase()} id=${row.id}${lifecycleChanged ? ' full-refresh=true' : ''}`,
    );

    reconcileTenantLifecycle();
  }, [loadData, property?.id]);
  const paymentDisplayRecord = useCallback((payment) => {
    if (!payment?.tenant_id) return payment;
    const tenant = [...tenantsRef.current, ...archivedTenantsRef.current].find(item => item.id === payment.tenant_id);
    if (!tenant) return payment;
    return {
      ...payment,
      tenants: payment.tenants || {
        id: tenant.id,
        name: tenant.name,
        phone: tenant.phone,
        email: tenant.email,
        room_id: tenant.room_id,
        profile_photo_path: tenant.profile_photo_path,
        rooms: { room_number: tenant.room_number || roomsRef.current.find(room => room.id === tenant.room_id)?.room_number || 'N/A' },
      },
    };
  }, []);

  const patchPaymentRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id) return;
    const knownTenant = [...tenantsRef.current, ...archivedTenantsRef.current].some(tenant => tenant.id === row.tenant_id);
    if (!knownTenant) return;
    setPaymentSeed(current => {
      const record = paymentDisplayRecord(row);
      const nextAll = payload.eventType === 'DELETE'
        ? removeRecord(current.allPayments || [], row.id)
        : upsertRecord(current.allPayments || [], record);
      const nextPending = payload.eventType === 'DELETE' || !isPendingRentPayment(record)
        ? removeRecord(current.pendingRentPayments || [], row.id)
        : upsertRecord(current.pendingRentPayments || [], record);
      setStats(prev => ({ ...prev, pendingRentConfirmations: nextPending.length }));
      setTenants(currentTenants => {
        const nextTenants = currentTenants.map(tenant => {
          if (tenant.id !== row.tenant_id) return tenant;
          const tenantPayments = nextAll.filter(payment => payment.tenant_id === tenant.id);
          const rentSummary = enrichTenantRentStatus(tenant, tenantPayments);
          return { ...tenant, rentSummary, dueStatus: rentSummary };
        });
        setStats(prev => ({ ...prev, ...summarizeOwnerRentStats(nextTenants), pendingRentConfirmations: nextPending.length }));
        return nextTenants;
      });
      return {
        ...current,
        pendingRentPayments: nextPending,
        allPayments: nextAll,
        version: current.version + 1,
      };
    });
    markOwnerDataPerf('realtime-local-patch', `table=payment_history action=${String(payload.eventType || '').toLowerCase()} id=${row.id}`);
  }, [paymentDisplayRecord]);

  const clearOwnerData = useCallback(() => {
    inFlightLoadRef.current = null;
    lastLoadedKeyRef.current = null;
    lastLoadedRequestKeyRef.current = null;
    lastLoadedPropertyRef.current = null;
    setProperties([]);
    setProperty(null);
    setOwnerProfile(null);
    setPropertyImages([]);
    setRooms([]);
    setTenants([]);
    setArchivedTenants([]);
    setRoomMonthlyIncome({});
    setPaymentSeed(current => ({ ...current, propertyId: null, pendingRentPayments: [], allPayments: [], version: current.version + 1 }));
    markOwnerDataPerf('owner-cache-cleared', 'reason=logout');
  }, []);

  useEffect(() => {
    const init = async () => {
      const auth = await checkAuthAndRedirect();
      if (!auth) return; if (auth.role !== 'owner') { router.replace(`/login/${auth.role || 'owner'}`); return; }
      localStorage.setItem('userId', auth.user.id); localStorage.setItem('userEmail', auth.user.email || ''); localStorage.setItem('userName', auth.user.user_metadata?.full_name || '');
      const loadedProperty = await loadData({ reason: 'initial-auth' });
      await Promise.all([
        loadSettings(loadedProperty),
        loadOwnerProfile(auth.user.id),
        loadMembershipRequest(auth.user.id, loadedProperty?.id),
      ]);
      const membershipExpired = calculateMembershipStatus(loadedProperty).status === 'expired';
      if (membershipExpired) { router.push('/owner/subscribe?reason=expired'); return; }
      startAutoRefresh();
    };
    init();
    const { data:{subscription} } = supabase.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT') { clearOwnerData(); clearHostelSetSessionCache(); router.replace('/login/owner'); } });
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); if (subscription) subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!property?.id) return undefined;

    let active = true;
    setRealtimeConnected(false);
    const handleCoreRealtime = (payload) => {
      if (!active) return;
      logRealtimeEvent(payload);
      if (payload.table === 'rooms') patchRoomRealtime(payload);
      else if (payload.table === 'tenants') patchTenantRealtime(payload);
      else if (payload.table === 'payment_history') patchPaymentRealtime(payload);
      else if (payload.table === 'properties' && payload.new?.id === property.id) {
        setProperty(current => current?.id === payload.new.id ? { ...current, ...payload.new } : current);
        updateMembershipFromProperty(payload.new);
        markOwnerDataPerf('realtime-local-patch', `table=properties action=${String(payload.eventType || '').toLowerCase()} id=${payload.new.id}`);
      } else {
        markOwnerDataPerf('realtime-local-patch-skipped', `table=${payload.table || 'unknown'} action=${String(payload.eventType || '').toLowerCase()}`);
      }
    };
    const channelName = `owner:${property.owner_id}:property:${property.id}:core`;
    const channel = createRealtimeChannel(supabase, channelName)
      .on('postgres_changes', { event:'*', schema:'public', table:'properties', filter:`owner_id=eq.${property.owner_id}` }, handleCoreRealtime)
      .on('postgres_changes', { event:'*', schema:'public', table:'rooms', filter:`property_id=eq.${property.id}` }, handleCoreRealtime)
      .on('postgres_changes', { event:'*', schema:'public', table:'tenants', filter:`property_id=eq.${property.id}` }, handleCoreRealtime)
      .on('postgres_changes', { event:'*', schema:'public', table:'payment_history' }, handleCoreRealtime)
      .on('postgres_changes', { event:'*', schema:'public', table:'owner_settings', filter:`owner_id=eq.${property.owner_id}` }, () => {
        markOwnerDataPerf('resource-specific-refresh', 'table=owner_settings');
        loadSettings(property);
      })
      .on('postgres_changes', { event:'*', schema:'public', table:'membership_requests', filter:`owner_id=eq.${property.owner_id}` }, () => {
        markOwnerDataPerf('resource-specific-refresh', 'table=membership_requests');
        loadMembershipRequest(property.owner_id, property.id).catch((error) => console.error('Membership request refresh failed:', error));
      })
    subscribeRealtimeChannel(channel, channelName, (isConnected) => { if (active) setRealtimeConnected(isConnected); });

    return () => {
      active = false;
      cleanupRealtimeChannel(supabase, channel, channelName, 'owner-provider-remount');
    };
  }, [property?.id, property?.owner_id, patchPaymentRealtime, patchRoomRealtime, patchTenantRealtime]);

  return (
    <OwnerContext.Provider value={{
      loading, isRefreshing, realtimeConnected, properties, property, selectProperty, propertyImages, setPropertyImages, rooms, tenants, archivedTenants,
      ownerProfile, loadOwnerProfile, updateOwnerProfile,
      settings, setSettings, stats, roomMonthlyIncome, setRoomMonthlyIncome, paymentSeed,
      membershipActive, membershipLoading, membershipStatus, membershipExpiry, daysLeft,
      pendingMembershipRequest, loadMembershipRequest, requestMembership,
      loadData, loadSettings, saveSettings, startAutoRefresh, updateMembershipFromProperty,
      setTenants, setRooms, setProperty, setStats
    }}>
      {children}
    </OwnerContext.Provider>
  );
}
export const useOwner = () => useContext(OwnerContext);
