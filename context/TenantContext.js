import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { clearHostelSetSessionCache, getRestoredSession, supabase, syncServerSession } from '../lib/supabase';
import { cleanupRealtimeChannel, createRealtimeChannel, logRealtimeEvent, subscribeRealtimeChannel } from '../lib/realtime';
import toast from 'react-hot-toast';
import { loadTenantProfilePhotoUrl } from '../products/hostels/tenant/profile';

const TenantContext = createContext();

const markTenantPerf = (label, detail = '', startedAt = null) => {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetTenantPerf') !== '1' || typeof performance === 'undefined') return;
  const elapsed = typeof startedAt === 'number' ? ` ${Math.round(performance.now() - startedAt)}ms` : '';
  console.info(`[TenantData] ${label}${elapsed}${detail ? ` ${detail}` : ''}`);
};

const timedTenantQuery = async (label, query) => {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : null;
  try {
    return await query;
  } finally {
    markTenantPerf(label, '', startedAt);
  }
};

const normalizeRefreshArgs = (isBackgroundOrOptions = false, options = {}) => {
  if (isBackgroundOrOptions && typeof isBackgroundOrOptions === 'object') {
    return {
      isBackground: Boolean(isBackgroundOrOptions.background),
      force: Boolean(isBackgroundOrOptions.force),
      reason: isBackgroundOrOptions.reason || 'manual-refresh',
    };
  }
  const isBackground = Boolean(isBackgroundOrOptions);
  return {
    isBackground,
    force: options.force ?? isBackground,
    reason: options.reason || (isBackground ? 'background-refresh' : 'initial-auth'),
  };
};

const tenantLoadKey = (userId, tenantId, propertyId) => `${userId || 'anonymous'}:${tenantId || 'auto'}:${propertyId || 'auto'}`;

export function TenantProvider({ children }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState(null);
  const [room, setRoom] = useState(null);
  const [property, setProperty] = useState(null);
  const [owner, setOwner] = useState(null);
  const [roommates, setRoommates] = useState([]);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [roommateVacateAlert, setRoommateVacateAlert] = useState(null);
  const [dashboardSnapshot, setDashboardSnapshot] = useState(null);
  const [dashboardSnapshotLoaded, setDashboardSnapshotLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const userIdRef = useRef(null);
  const profilePhotoCacheRef = useRef(new Map());
  const inFlightLoadRef = useRef(null);
  const lastLoadedKeyRef = useRef(null);
  const lastLoadedRequestKeyRef = useRef(null);
  const lastLoadedResultRef = useRef(null);
  const tenantRef = useRef(null);
  const roomRef = useRef(null);
  const propertyRef = useRef(null);
  const roommatesRef = useRef([]);

  useEffect(() => { tenantRef.current = tenant; }, [tenant]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { propertyRef.current = property; }, [property]);
  useEffect(() => { roommatesRef.current = roommates; }, [roommates]);

  const loadTenantProfilePhoto = useCallback(async (tenantData) => {
    if (!tenantData?.id || !tenantData?.property_id) {
      setProfilePhotoUrl(null);
      return null;
    }

    try {
      const url = await loadTenantProfilePhotoUrl(supabase, fetch, tenantData, profilePhotoCacheRef.current);
      setProfilePhotoUrl(url);
      return url;
    } catch (photoError) {
      if (process.env.NODE_ENV !== 'production') console.warn('[HostelSet] Tenant profile photo could not be loaded.');
      setProfilePhotoUrl(null);
      return null;
    }
  }, []);

  const refreshData = useCallback(async (isBackgroundOrOptions = false, legacyOptions = {}) => {
    const { isBackground, force, reason } = normalizeRefreshArgs(isBackgroundOrOptions, legacyOptions);
    let userId = userIdRef.current;
    if (!userId) {
      const { data: { session }, error: authError } = await getRestoredSession();
      const user = session?.user;
      if (authError || !user) {
        await router.replace('/login/tenant');
        return false;
      }
      userId = user.id;
      userIdRef.current = user.id;
    }

    const currentTenant = tenantRef.current;
    const currentProperty = propertyRef.current;
    const requestKey = tenantLoadKey(userId, currentTenant?.id, currentProperty?.id);
    markTenantPerf('load-requested', `reason=${reason} key=${requestKey}${force ? ' force=true' : ''}`);

    const inFlight = inFlightLoadRef.current;
    if (inFlight && inFlight.userId === userId) {
      markTenantPerf('load-joined-in-flight', `reason=${reason} key=${requestKey}`);
      return inFlight.promise;
    }

    if (!force && lastLoadedResultRef.current && (lastLoadedKeyRef.current === requestKey || lastLoadedRequestKeyRef.current === requestKey)) {
      markTenantPerf('load-skipped-cached', `reason=${reason} key=${requestKey}`);
      return lastLoadedResultRef.current;
    }

    const runLoad = async () => {
      const loadStartedAt = typeof performance !== 'undefined' ? performance.now() : null;
      markTenantPerf(isBackground ? 'background-refresh-network-start' : 'core-load-start', `reason=${reason} key=${requestKey}${force ? ' force=true' : ''}`);
      if (!isBackground) setLoading(true);
      try {
        const snapshotResult = await timedTenantQuery(
          'tenant-dashboard-snapshot',
          supabase.rpc('get_my_tenant_dashboard_snapshot'),
        );
        const snapshotData = !snapshotResult.error
          && snapshotResult.data
          && typeof snapshotResult.data === 'object'
          && snapshotResult.data.snapshot_version === 1
          ? snapshotResult.data
          : null;

        let roleResult;
        let tenantResult;
        if (snapshotData) {
          roleResult = { data: { role: snapshotData.role }, error: null };
          tenantResult = { data: snapshotData.tenant || null, error: null };
        } else {
          if (snapshotResult.error && process.env.NODE_ENV !== 'production') {
            console.warn('[HostelSet] Tenant snapshot unavailable; using compatible query fallback.', snapshotResult.error.message);
          }
          const shouldCheckRole = !lastLoadedResultRef.current;
          [roleResult, tenantResult] = await Promise.all([
            shouldCheckRole
              ? timedTenantQuery('user-role', supabase.from('users').select('role').eq('id', userId).single())
              : Promise.resolve({ data: { role: 'tenant' }, error: null }),
            timedTenantQuery('tenant-profile', supabase
              .from('tenants')
              .select('*, rooms:room_id(*), property:property_id(*)')
              .eq('user_id', userId)
              .maybeSingle()),
          ]);
        }

        if (roleResult.error || roleResult.data?.role !== 'tenant') {
          toast.error('Access denied. You are not registered as a tenant.');
          await router.replace(`/login/${roleResult.data?.role || 'tenant'}`);
          return false;
        }

        const { data: tenantData, error: tenantError } = tenantResult;

        if (tenantError) throw tenantError;
        if (!tenantData) {
          if (isBackground) return false;
          setTenant(null);
          setRoom(null);
          setProperty(null);
          setOwner(null);
          setRoommates([]);
          setProfilePhotoUrl(null);
          setRoommateVacateAlert(null);
          setDashboardSnapshot(null);
          setDashboardSnapshotLoaded(false);
          setError('No tenant record found in the database.');
          lastLoadedKeyRef.current = null;
          lastLoadedRequestKeyRef.current = null;
          lastLoadedResultRef.current = null;
          return false;
        }

        setTenant(tenantData);
        setRoom(tenantData.rooms || null);
        setProperty(tenantData.property || null);
        setDashboardSnapshot(snapshotData);
        setDashboardSnapshotLoaded(Boolean(snapshotData));
        setError(null);
        loadTenantProfilePhoto(tenantData);
        if (!isBackground) {
          markTenantPerf('first-usable-data', `reason=${reason} key=${tenantLoadKey(userId, tenantData.id, tenantData.property_id)}`, loadStartedAt);
          setLoading(false);
        }

        const [ownerResult, roommatesResult] = await Promise.all([
          snapshotData
            ? Promise.resolve({ data: snapshotData.owner || null, error: null })
            : tenantData.property?.owner_id
            ? timedTenantQuery('owner-contact', supabase.from('users').select('full_name, phone, email').eq('id', tenantData.property.owner_id).maybeSingle())
            : Promise.resolve({ data: null, error: null }),
          tenantData.room_id
            ? timedTenantQuery('roommates', supabase.rpc('get_my_roommate_contacts'))
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (ownerResult.error) throw ownerResult.error;
        if (roommatesResult.error) throw roommatesResult.error;

        const roommateRows = roommatesResult.data || [];
        let vacateAlert = null;
        const roommateIds = roommateRows.map((roommate) => roommate.id);
        if (roommateIds.length) {
          const { data: vacateRequests, error: vacateError } = await timedTenantQuery('roommate-vacate-alert', supabase
            .from('check_out_requests')
            .select('id, tenant_id, tenant_name, expected_check_out, status')
            .in('tenant_id', roommateIds)
            .in('status', ['pending', 'approved'])
            .order('created_at', { ascending: false })
            .limit(1));
          if (vacateError) throw vacateError;
          const request = vacateRequests?.[0];
          if (request) {
            const vacateDate = new Date(request.expected_check_out);
            const daysLeft = Math.max(0, Math.ceil((vacateDate - new Date()) / (1000 * 60 * 60 * 24)));
            vacateAlert = {
              ...request,
              name: request.tenant_name || roommateRows.find((mate) => mate.id === request.tenant_id)?.name || 'A roommate',
              date: request.expected_check_out,
              daysLeft,
            };
          }
        }

        setTenant(tenantData);
        setRoom(tenantData.rooms || null);
        setProperty(tenantData.property || null);
        setOwner(ownerResult.data || null);
        setRoommates(roommateRows);
        setRoommateVacateAlert(vacateAlert);
        setError(null);
        const result = { tenant: tenantData, property: tenantData.property || null };
        lastLoadedKeyRef.current = tenantLoadKey(userId, tenantData.id, tenantData.property_id);
        lastLoadedRequestKeyRef.current = requestKey;
        lastLoadedResultRef.current = result;
        markTenantPerf(isBackground ? 'background-refresh-finish' : 'core-load-finish', `reason=${reason} key=${lastLoadedKeyRef.current}`, loadStartedAt);
        return result;
      } catch (loadError) {
        console.error('Failed to load tenant dashboard:', loadError);
        setError(loadError.message);
        if (!isBackground) toast.error('Failed to load dashboard: ' + loadError.message);
        return false;
      } finally {
        if (!isBackground) setLoading(false);
      }
    };

    const promise = runLoad();
    inFlightLoadRef.current = { userId, key: requestKey, promise };
    try {
      return await promise;
    } finally {
      if (inFlightLoadRef.current?.promise === promise) inFlightLoadRef.current = null;
    }
  }, [loadTenantProfilePhoto, router]);

  const refreshRoommates = useCallback(async (reason = 'roommates-resource-refresh') => {
    const currentTenant = tenantRef.current;
    if (!currentTenant?.room_id) return;
    markTenantPerf('resource-specific-refresh', `reason=${reason} resource=roommates`);
    const { data, error } = await timedTenantQuery('roommates', supabase.rpc('get_my_roommate_contacts'));
    if (error) {
      console.error('Roommates refresh failed:', error);
      return;
    }
    setRoommates(data || []);
  }, []);

  const clearTenantData = useCallback(() => {
    inFlightLoadRef.current = null;
    lastLoadedKeyRef.current = null;
    lastLoadedRequestKeyRef.current = null;
    lastLoadedResultRef.current = null;
    userIdRef.current = null;
    profilePhotoCacheRef.current.clear();
    setTenant(null);
    setRoom(null);
    setProperty(null);
    setOwner(null);
    setRoommates([]);
    setProfilePhotoUrl(null);
    setRoommateVacateAlert(null);
    setDashboardSnapshot(null);
    setDashboardSnapshotLoaded(false);
    setError(null);
    markTenantPerf('tenant-cache-cleared', 'reason=logout');
  }, []);

  const patchTenantRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id) return;

    if (payload.eventType === 'DELETE' && row.id === tenantRef.current?.id) {
      setTenant(null);
      setRoom(null);
      setProperty(null);
      setOwner(null);
      setRoommates([]);
      setRoommateVacateAlert(null);
      setDashboardSnapshot(null);
      setDashboardSnapshotLoaded(false);
      setError('No tenant record found in the database.');
      markTenantPerf('realtime-local-patch', `table=tenants action=delete id=${row.id}`);
      return;
    }

    if (row.id === tenantRef.current?.id) {
      const currentTenant = tenantRef.current;
      const relationChanged =
        row.room_id !== currentTenant?.room_id ||
        row.property_id !== currentTenant?.property_id ||
        row.status !== currentTenant?.status;

      setTenant(current => current?.id === row.id ? { ...current, ...row } : current);
      loadTenantProfilePhoto({ ...(currentTenant || {}), ...row });
      markTenantPerf(
        'realtime-local-patch',
        `table=tenants action=${String(payload.eventType || '').toLowerCase()} id=${row.id}${relationChanged ? ' full-refresh=true' : ''}`,
      );

      if (relationChanged) {
        void refreshData({
          background: true,
          force: true,
          reason: 'tenant-relation-realtime-change',
        });
      }
      return;
    }

    if (row.room_id === roomRef.current?.id || payload.old?.room_id === roomRef.current?.id) {
      refreshRoommates('tenant-roommate-change');
    }
  }, [loadTenantProfilePhoto, refreshData, refreshRoommates]);

  const patchRoomRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id || row.id !== roomRef.current?.id) return;
    if (payload.eventType === 'DELETE') setRoom(null);
    else setRoom(current => current?.id === row.id ? { ...current, ...row } : current);
    markTenantPerf('realtime-local-patch', `table=rooms action=${String(payload.eventType || '').toLowerCase()} id=${row.id}`);
  }, []);

  const patchPropertyRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.id || row.id !== propertyRef.current?.id) return;
    if (payload.eventType === 'DELETE') setProperty(null);
    else setProperty(current => current?.id === row.id ? { ...current, ...row } : current);
    markTenantPerf('realtime-local-patch', `table=properties action=${String(payload.eventType || '').toLowerCase()} id=${row.id}`);
  }, []);

  const patchOwnerRealtime = useCallback((payload) => {
    if (payload.eventType === 'DELETE') return;
    if (!payload.new?.id || payload.new.id !== propertyRef.current?.owner_id) return;
    setOwner(current => ({ ...(current || {}), full_name: payload.new.full_name, phone: payload.new.phone, email: payload.new.email }));
    markTenantPerf('realtime-local-patch', `table=users action=${String(payload.eventType || '').toLowerCase()} id=${payload.new.id}`);
  }, []);

  const patchRoommateVacateRealtime = useCallback((payload) => {
    const row = payload.new || payload.old;
    if (!row?.tenant_id) return;
    const roommate = roommatesRef.current.find(item => item.id === row.tenant_id);
    if (!roommate) return;
    if (payload.eventType === 'DELETE' || !['pending', 'approved'].includes(row.status)) {
      setRoommateVacateAlert(current => current?.id === row.id ? null : current);
      markTenantPerf('realtime-local-patch', `table=check_out_requests action=remove id=${row.id}`);
      return;
    }
    const vacateDate = new Date(row.expected_check_out);
    setRoommateVacateAlert({
      ...row,
      name: row.tenant_name || roommate.name || 'A roommate',
      date: row.expected_check_out,
      daysLeft: Math.max(0, Math.ceil((vacateDate - new Date()) / (1000 * 60 * 60 * 24))),
    });
    markTenantPerf('realtime-local-patch', `table=check_out_requests action=${String(payload.eventType || '').toLowerCase()} id=${row.id}`);
  }, []);

  useEffect(() => {
    refreshData({ reason: 'initial-auth' });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearTenantData();
        clearHostelSetSessionCache();
        router.replace('/login/tenant');
      } else if (event === 'TOKEN_REFRESHED' && session) {
        syncServerSession(session).catch((sessionError) => console.error('Unable to refresh server session:', sessionError));
      }
    });

    return () => subscription.unsubscribe();
  }, [clearTenantData, refreshData, router]);

  useEffect(() => {
    if (!tenant?.id || !room?.id || !property?.id) return undefined;

    let active = true;
    setRealtimeConnected(false);
    const handleTenantRealtime = (payload) => {
      if (!active) return;
      logRealtimeEvent(payload);
      if (payload.table === 'tenants') patchTenantRealtime(payload);
      else if (payload.table === 'rooms') patchRoomRealtime(payload);
      else if (payload.table === 'properties') patchPropertyRealtime(payload);
      else if (payload.table === 'users') patchOwnerRealtime(payload);
      else if (payload.table === 'check_out_requests') patchRoommateVacateRealtime(payload);
      else markTenantPerf('realtime-local-patch-skipped', `table=${payload.table || 'unknown'}`);
    };
    const channelName = `tenant:${tenant.id}:user:${tenant.user_id}:property:${property.id}:core`;
    let channel = createRealtimeChannel(supabase, channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants', filter: `user_id=eq.${tenant.user_id}` }, handleTenantRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants', filter: `room_id=eq.${room.id}` }, handleTenantRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` }, handleTenantRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties', filter: `id=eq.${property.id}` }, handleTenantRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_out_requests', filter: `room_id=eq.${room.id}` }, handleTenantRealtime);

    if (property.owner_id) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${property.owner_id}` }, handleTenantRealtime);
    }

    subscribeRealtimeChannel(channel, channelName, (isConnected) => { if (active) setRealtimeConnected(isConnected); });
    return () => {
      active = false;
      cleanupRealtimeChannel(supabase, channel, channelName, 'tenant-provider-remount');
    };
  }, [tenant?.id, tenant?.user_id, room?.id, property?.id, property?.owner_id, patchOwnerRealtime, patchPropertyRealtime, patchRoomRealtime, patchRoommateVacateRealtime, patchTenantRealtime]);

  return (
    <TenantContext.Provider value={{
      loading,
      tenant,
      setTenant,
      room,
      property,
      owner,
      roommates,
      profilePhotoUrl,
      roommateVacateAlert,
      dashboardSnapshot,
      dashboardSnapshotLoaded,
      error,
      realtimeConnected,
      refreshData,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
