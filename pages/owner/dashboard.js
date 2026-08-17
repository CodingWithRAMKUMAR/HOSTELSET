import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AnimatePresence } from 'framer-motion';
import { DashboardSkeleton } from '../../components/ui/Skeleton';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { clearOwnerTenantProfilePhotoCache, getOwnerTenantProfilePhotoUrls, getResetPasswordRedirectTo, supabase, signOut, signPrivateDocumentFields, findTenantDocumentRecord, openSignedPrivateDocument } from '../../lib/supabase';
import toast from 'react-hot-toast';
import BrandLogo from '../../components/BrandLogo';
import NotificationBell from '../../components/common/NotificationBell';
import ThemeToggle from '../../components/common/ThemeToggle';
import { formatCurrency, formatDate } from '../../lib/utils';
import { buildDashboardHref, isCanonicalDashboardQuery, pushDashboardHistory, replaceDashboardHistory, resolveOwnerDashboardQuery } from '../../lib/dashboardRouting';
import { filterTenantsByRentStatus, summarizeTenantRentStatuses } from '../../lib/tenantRentStatus';
import {
  archiveOwnerTenant,
  convertReservedPrebookingForReleasedRoom,
} from '../../products/hostels/owner/tenants';

// Modular Imports
import { useOwner, OwnerProvider } from '../../context/OwnerContext';
import { useOwnerRooms } from '../../hooks/useOwnerRooms';
import { useOwnerTenants } from '../../hooks/useOwnerTenants';
import { useOwnerComplaints } from '../../hooks/useOwnerComplaints';
import { useOwnerVacate } from '../../hooks/useOwnerVacate';
import { useOwnerPayments } from '../../hooks/useOwnerPayments';
import { useOwnerNotices } from '../../hooks/useOwnerNotices';
import { useOwnerRoomChange } from '../../hooks/useOwnerRoomChange';
import { useOwnerApplications } from '../../hooks/useOwnerApplications';
import { useOwnerPreBookings } from '../../hooks/useOwnerPreBookings';
import { useExistingTenantImports } from '../../hooks/useExistingTenantImports';
import { useOwnerAnalytics } from '../../hooks/useOwnerAnalytics';

// Content Components
import StatsCards from '../../components/owner/StatsCards';
import DashboardSectionNav from '../../components/dashboard/DashboardSectionNav';
import MobileTopbar from '../../components/dashboard/MobileTopbar';
import MobileBottomNav from '../../components/dashboard/MobileBottomNav';
import DashboardMoreMenu from '../../components/dashboard/DashboardMoreMenu';
import DashboardSidebar from '../../components/dashboard/DashboardSidebar';
import DashboardIcon from '../../components/dashboard/DashboardIcon';
import AccountMenu from '../../components/dashboard/AccountMenu';
import { resetDashboardScroll } from '../../lib/dashboardScroll';
import { dashboardPanelProps, prepareDashboardTabFocus } from '../../lib/dashboardFocus';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import OwnerMobileDashboard from '../../components/owner/mobile/OwnerMobileDashboard';
import OwnerMobileRooms from '../../components/owner/mobile/OwnerMobileRooms';
import OwnerMobileTenants from '../../components/owner/mobile/OwnerMobileTenants';
import OwnerMobilePayments from '../../components/owner/mobile/OwnerMobilePayments';
import OwnerMobileMore from '../../components/owner/mobile/OwnerMobileMore';
import OwnerMobileRoomDetailsSheet from '../../components/owner/mobile/OwnerMobileRoomDetailsSheet';

const OWNER_VIEW_KEYS = {
  OVERVIEW: 'overview',
  ANALYTICS: 'analytics',
  ROOMS: 'rooms',
  TENANTS: 'tenants',
  ARCHIVED_TENANTS: 'archived-tenants',
  RENT_PAYMENTS: 'rent-payments',
  PAYMENT_HISTORY: 'payment-history',
  PRE_BOOKINGS: 'pre-bookings',
  APPLICATIONS: 'applications',
  EXISTING_IMPORTS: 'existing-imports',
  COMPLAINTS: 'complaints',
  VACATE: 'vacate',
  ROOM_CHANGE: 'room-change',
  NOTICES: 'notices',
  MEMBERSHIP: 'membership',
}

const OWNER_VIEW_ALIASES = {
  imports: OWNER_VIEW_KEYS.EXISTING_IMPORTS,
  rent: OWNER_VIEW_KEYS.RENT_PAYMENTS,
  payments: OWNER_VIEW_KEYS.RENT_PAYMENTS,
  history: OWNER_VIEW_KEYS.PAYMENT_HISTORY,
  roomChange: OWNER_VIEW_KEYS.ROOM_CHANGE,
  roomchange: OWNER_VIEW_KEYS.ROOM_CHANGE,
}

const OWNER_VIEW_SET = new Set(Object.values(OWNER_VIEW_KEYS))
const MAIN_OWNER_MOBILE_TABS = [OWNER_VIEW_KEYS.OVERVIEW, OWNER_VIEW_KEYS.ROOMS, OWNER_VIEW_KEYS.TENANTS, OWNER_VIEW_KEYS.RENT_PAYMENTS]
const PERSISTENT_OWNER_MOBILE_TABS = [
  OWNER_VIEW_KEYS.OVERVIEW,
  OWNER_VIEW_KEYS.ROOMS,
  OWNER_VIEW_KEYS.TENANTS,
  OWNER_VIEW_KEYS.RENT_PAYMENTS,
  OWNER_VIEW_KEYS.COMPLAINTS,
  OWNER_VIEW_KEYS.NOTICES,
  OWNER_VIEW_KEYS.ANALYTICS,
  OWNER_VIEW_KEYS.MEMBERSHIP,
]

function OwnerSectionSkeleton({ rows = 3 }) {
  return (
    <section className="space-y-2" aria-busy="true" aria-label="Loading section">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-2xl border border-white/10 bg-white p-3 shadow-sm">
          <div className="mb-3 h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </section>
  )
}

const sectionLoading = () => <OwnerSectionSkeleton />

const RoomList = dynamic(() => import('../../components/owner/RoomList'), { loading: sectionLoading });
const TenantTable = dynamic(() => import('../../components/owner/TenantTable'), { loading: sectionLoading });
const ArchivedTenantList = dynamic(() => import('../../components/owner/ArchivedTenantList'), { loading: sectionLoading });
const RentPaymentsList = dynamic(() => import('../../components/owner/RentPaymentsList'), { loading: sectionLoading });
const PaymentHistoryTable = dynamic(() => import('../../components/owner/PaymentHistoryTable'), { loading: sectionLoading });
const PreBookingList = dynamic(() => import('../../components/owner/PreBookingList'), { loading: sectionLoading });
const ApplicationList = dynamic(() => import('../../components/owner/ApplicationList'), { loading: sectionLoading });
const ComplaintList = dynamic(() => import('../../components/owner/ComplaintList'), { loading: sectionLoading });
const VacateRequestList = dynamic(() => import('../../components/owner/VacateRequestList'), { loading: sectionLoading });
const NoticeList = dynamic(() => import('../../components/owner/NoticeList'), { loading: sectionLoading });
const RoomChangeRequestList = dynamic(() => import('../../components/owner/RoomChangeRequestList'), { loading: sectionLoading });
const ExistingTenantImportList = dynamic(() => import('../../components/owner/ExistingTenantImportList'), { loading: sectionLoading });
const ExistingTenantImportSettings = dynamic(() => import('../../components/owner/ExistingTenantImportSettings'), { loading: sectionLoading });
const OwnerAnalytics = dynamic(() => import('../../components/analytics/OwnerAnalytics'), { loading: sectionLoading });

// Modal Components
const ConfirmDeleteModal = dynamic(() => import('../../components/owner/modals/ConfirmDeleteModal'), { ssr: false });
const AddTenantModal = dynamic(() => import('../../components/owner/modals/AddTenantModal'), { ssr: false });
const AddRoomModal = dynamic(() => import('../../components/owner/modals/AddRoomModal'), { ssr: false });
const CollectRentModal = dynamic(() => import('../../components/owner/modals/CollectRentModal'), { ssr: false });
const PostNoticeModal = dynamic(() => import('../../components/owner/modals/PostNoticeModal'), { ssr: false });
const SettingsModal = dynamic(() => import('../../components/owner/modals/SettingsModal'), { ssr: false });
const ComplaintResponseModal = dynamic(() => import('../../components/owner/modals/ComplaintResponseModal'), { ssr: false });
const RoomDetailsModal = dynamic(() => import('../../components/owner/modals/RoomDetailsModal'), { ssr: false });
const MembershipModal = dynamic(() => import('../../components/owner/modals/MembershipModal'), { ssr: false });
const PaymentConfirmModal = dynamic(() => import('../../components/owner/modals/PaymentConfirmModal'), { ssr: false });
const ApplicationDetailModal = dynamic(() => import('../../components/owner/modals/ApplicationDetailModal'), { ssr: false });
const TenantPaymentsModal = dynamic(() => import('../../components/owner/modals/TenantPaymentsModal'), { ssr: false });
const TenantProfileModal = dynamic(() => import('../../components/owner/modals/TenantProfileModal'), { ssr: false });
const RoomChangeReasonModal = dynamic(() => import('../../components/owner/modals/RoomChangeReasonModal'), { ssr: false });
const VacateRejectionModal = dynamic(() => import('../../components/owner/modals/VacateRejectionModal'), { ssr: false });
const ScreenshotModal = dynamic(() => import('../../components/owner/modals/ScreenshotModal'), { ssr: false });
const OwnerProfileModal = dynamic(() => import('../../components/owner/modals/OwnerProfileModal'), { ssr: false });
const ArchivedTenantHistoryModal = dynamic(() => import('../../components/owner/modals/ArchivedTenantHistoryModal'), { ssr: false });

const OWNER_DESKTOP_MIN_WIDTH = 1280

function useDesktopDashboard() {
  const [isDesktop, setIsDesktop] = useState(null)
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${OWNER_DESKTOP_MIN_WIDTH}px)`)
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return isDesktop
}

function useStableCallback(callback) {
  const callbackRef = useRef(callback)
  useEffect(() => { callbackRef.current = callback }, [callback])
  return useCallback((...args) => callbackRef.current?.(...args), [])
}

function markOwnerPerf(label, detail = '') {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetOwnerPerf') !== '1' || typeof performance === 'undefined') return
  if (process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) return
  const ms = Math.round(performance.now())
  console.debug(`[OwnerDashboard perf] ${label}${detail ? ` ${detail}` : ''} @ ${ms}ms`)
}

function OwnerMobileTabPanel({ tab, active, children }) {
  useEffect(() => {
    if (active) markOwnerPerf('visible-commit', tab)
  }, [active, tab])
  return (
    <section key={tab} {...dashboardPanelProps('owner', tab, active)} data-owner-mobile-tab={tab}>
      {children}
    </section>
  )
}

function safeTenantPhotoIds(tenants = []) {
  return (Array.isArray(tenants) ? tenants : [])
    .filter(tenant => tenant?.id)
    .map(tenant => ({
      id: tenant.id,
      cacheKey: `${tenant.id}:${tenant.profile_photo_path || ''}:${tenant.updated_at || tenant.move_in_date || ''}`,
    }))
}

export default function OwnerDashboard() {
  return (
    <OwnerProvider>
      <OwnerDashboardShell />
    </OwnerProvider>
  );
}

function OwnerDashboardShell() {
  return <OwnerDashboardContent />;
}

function OwnerDashboardContent() {
  const router = useRouter();
  const isDesktopDashboard = useDesktopDashboard();
  const core = useOwner();
  const { 
    loading,
    realtimeConnected,
    properties,
    property, 
    selectProperty,
    ownerProfile,
    updateOwnerProfile,
    rooms, 
    setRooms, 
    tenants, 
    archivedTenants,
    setTenants, 
    settings, 
    setSettings, 
    stats, 
    setStats, 
    paymentSeed,
    roomMonthlyIncome, 
    membershipActive, 
    membershipLoading, 
    membershipStatus,
    membershipExpiry,
    daysLeft,
    loadData, 
    saveSettings, 
    pendingMembershipRequest,
    requestMembership
  } = core;
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenu, setMobileMenu] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const sectionRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const openSection = (tab) => {
    markOwnerPerf('tab-click', String(tab))
    const nextTab = OWNER_VIEW_ALIASES[tab] || tab;
    if (!OWNER_VIEW_SET.has(nextTab)) {
      if (process.env.NODE_ENV !== 'production') console.warn(`[OwnerDashboard] Unknown owner view key: ${tab}`);
      const fallbackHref = buildDashboardHref('owner', OWNER_VIEW_KEYS.OVERVIEW, router.query)
      setActiveTab(OWNER_VIEW_KEYS.OVERVIEW)
      setMobileMenu(null)
      setProfileMenuOpen(false)
      replaceDashboardHistory(router, fallbackHref)
      return;
    }
    if (!router.isReady || nextTab === activeTab) {
      setMobileMenu(null);
      setProfileMenuOpen(false);
      return;
    }
    const href = buildDashboardHref('owner', nextTab, router.query)
    markOwnerPerf('set-activeTab', nextTab)
    prepareDashboardTabFocus('owner', activeTabRef.current, nextTab)
    setActiveTab(nextTab);
    setMobileMenu(null);
    setProfileMenuOpen(false);
    closeOwnerOverlaysForNavigation();
    resetDashboardScroll();
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        markOwnerPerf('router-push-start', nextTab)
        Promise.resolve(pushDashboardHistory(router, href)).finally(() => markOwnerPerf('router-push-finish', nextTab))
      });
      return;
    }
    markOwnerPerf('router-push-start', nextTab)
    Promise.resolve(pushDashboardHistory(router, href)).finally(() => markOwnerPerf('router-push-finish', nextTab))
  };
  const navigateDashboardBack = () => {
    setMobileMenu(null);
    setProfileMenuOpen(false);
    if (activeTab !== OWNER_VIEW_KEYS.OVERVIEW) {
      replaceDashboardHistory(router, buildDashboardHref('owner', OWNER_VIEW_KEYS.OVERVIEW, router.query));
      prepareDashboardTabFocus('owner', activeTabRef.current, OWNER_VIEW_KEYS.OVERVIEW);
      setActiveTab(OWNER_VIEW_KEYS.OVERVIEW);
      resetDashboardScroll();
      return
    }
    router.back();
  };

  useEffect(() => {
    if (!property?.id) return undefined;
    const preload = () => {
      [RoomList, TenantTable, RentPaymentsList, PaymentHistoryTable, ApplicationList, ComplaintList, VacateRequestList, NoticeList, RoomChangeRequestList,
        OwnerAnalytics, AddTenantModal, AddRoomModal, CollectRentModal, PostNoticeModal, SettingsModal, RoomDetailsModal, PaymentConfirmModal, TenantPaymentsModal, TenantProfileModal,
      ].forEach(component => component.preload?.());
    };
    const timerId = window.setTimeout(preload, 0);
    return () => window.clearTimeout(timerId);
  }, [property?.id]);

  const { showRoomModal, setShowRoomModal, roomForm, setRoomForm, sharingTypes, addRoom, deleteRoom } = useOwnerRooms(property, rooms, setRooms, setStats);
  const { formData, setFormData, addTenant } = useOwnerTenants(property, rooms, tenants, setTenants, setStats, loadData);
  const propertyReady = Boolean(property?.id);

  const [focusedRequestId, setFocusedRequestId] = useState(null)
  useEffect(() => {
    if (!router.isReady) return
    const resolved = resolveOwnerDashboardQuery(router.query)
    if (!isCanonicalDashboardQuery('owner', router.query)) {
      replaceDashboardHistory(router, buildDashboardHref('owner', resolved.view, router.query))
      prepareDashboardTabFocus('owner', activeTabRef.current, resolved.view)
      setActiveTab(resolved.view)
      setFocusedRequestId(resolved.requestId)
      setMobileMenu(null)
      resetDashboardScroll()
      return
    }
    if (activeTabRef.current !== resolved.view) {
      resetDashboardScroll()
      prepareDashboardTabFocus('owner', activeTabRef.current, resolved.view)
    }
    setActiveTab(resolved.view)
    setFocusedRequestId(resolved.requestId)
    setMobileMenu(null)
  }, [router.isReady, router.query.tab, router.query.request_id])
  const [analyticsVisited, setAnalyticsVisited] = useState(false);
  useEffect(() => {
    if (activeTab === OWNER_VIEW_KEYS.ANALYTICS) setAnalyticsVisited(true);
  }, [activeTab]);
  const { complaints, respondToComplaint, resolveComplaint } = useOwnerComplaints(property, propertyReady);
  const { vacateRequests, approveVacateRequest, rejectVacateRequest, rejectingId: vacateRejectingId } = useOwnerVacate(property, propertyReady);
  const { pendingRentPayments, allPayments, confirmRentPayment, rejectRentPayment } = useOwnerPayments(property, tenants, archivedTenants, setStats, loadData, propertyReady, paymentSeed);
  const { notices, postNotice, deleteNotice } = useOwnerNotices(property, propertyReady);
  const { roomChangeRequests, approveRoomChange, rejectRoomChange } = useOwnerRoomChange(property, loadData, propertyReady);
  const { applications, approveApplication, rejectApplication, resendPasswordEmail, processingId: applicationProcessingId } = useOwnerApplications(property, propertyReady);
  const { preBookings, approvePreBooking, rejectPreBooking, convertReservedPreBooking, processingId: prebookingProcessingId } = useOwnerPreBookings(property, propertyReady);
  const existingImports = useExistingTenantImports(property, propertyReady, () => loadData({ background: true, force: true, reason: 'existing-import-action-reconciliation' }));
  const ownerAnalytics = useOwnerAnalytics(property, analyticsVisited || activeTab === OWNER_VIEW_KEYS.ANALYTICS);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [showRoomDetailsModal, setShowRoomDetailsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showComplaintResponseModal, setShowComplaintResponseModal] = useState(false);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [showPaymentConfirmModal, setShowPaymentConfirmModal] = useState(false);
  const [showApplicationDetailModal, setShowApplicationDetailModal] = useState(false);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const [showOwnerProfileModal, setShowOwnerProfileModal] = useState(false);
  const [showArchivedHistoryModal, setShowArchivedHistoryModal] = useState(false);
  const [showRoomChangeReasonModal, setShowRoomChangeReasonModal] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [selectedRoomChangeRequest, setSelectedRoomChangeRequest] = useState(null);
  const [selectedVacateRequest, setSelectedVacateRequest] = useState(null);
  const [confirmingTenant, setConfirmingTenant] = useState(null);
  const [tenantToDelete, setTenantToDelete] = useState(null);
  const [complaintResponse, setComplaintResponse] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [vacateRejectionReason, setVacateRejectionReason] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantRentFilter, setTenantRentFilter] = useState('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [collectionRequestId, setCollectionRequestId] = useState(null);
  const [noticeForm, setNoticeForm] = useState({ title: '', content: '', type: 'general', is_urgent: false, image_file: null });
  const [mountedMobileTabs, setMountedMobileTabs] = useState(() => new Set([OWNER_VIEW_KEYS.OVERVIEW]));

  // Modal States for History & Profile
  const [showTenantPaymentsModal, setShowTenantPaymentsModal] = useState(false);
  const [showTenantProfileModal, setShowTenantProfileModal] = useState(false);
  const [selectedTenantForPayments, setSelectedTenantForPayments] = useState(null);
  const [selectedProfileTenant, setSelectedProfileTenant] = useState(null);
  const [tenantPayments, setTenantPayments] = useState([]);
  const [tenantApplication, setTenantApplication] = useState(null);  const [tenantExtraDocuments, setTenantExtraDocuments] = useState([]);  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [tenantPhotoUpdating, setTenantPhotoUpdating] = useState(false);
  const [archivedHistory, setArchivedHistory] = useState(null);
  const [loadingArchivedTenantId, setLoadingArchivedTenantId] = useState(null);
  const profileCache = useRef(new Map());
  const paymentCache = useRef(new Map());
  const [tenantPhotoUrls, setTenantPhotoUrls] = useState({});
  function closeOwnerOverlaysForNavigation() {
    setShowAddModal(false); setShowRoomModal(false); setShowPaymentModal(false); setShowNoticeModal(false); setShowRoomDetailsModal(false); setShowSettingsModal(false);
    setShowComplaintResponseModal(false); setShowConfirmDeleteModal(false); setShowMembershipModal(false); setShowPaymentConfirmModal(false);
    setShowApplicationDetailModal(false); setShowScreenshotModal(false); setShowOwnerProfileModal(false); setShowArchivedHistoryModal(false);
    setShowRoomChangeReasonModal(false); setShowTenantPaymentsModal(false); setShowTenantProfileModal(false);
    setSelectedVacateRequest(null); setSelectedRoom(null); setSelectedTenant(null); setSelectedComplaint(null); setSelectedApplication(null);
    setSelectedRoomChangeRequest(null); setConfirmingTenant(null); setTenantToDelete(null); setScreenshotUrl('');
  }
  const hasOpenOverlay = showPaymentModal || showConfirmDeleteModal || showSettingsModal || showAddModal || showRoomModal || showNoticeModal || showMembershipModal || showOwnerProfileModal || showArchivedHistoryModal || showComplaintResponseModal || showRoomChangeReasonModal || Boolean(selectedVacateRequest) || showPaymentConfirmModal || showRoomDetailsModal || showTenantPaymentsModal || showTenantProfileModal || showScreenshotModal || profileMenuOpen || mobileMenu === 'more';
  useBodyScrollLock(hasOpenOverlay);
  const tenantPhotoSignature = useMemo(() => safeTenantPhotoIds(tenants).map(item => item.cacheKey).join('|'), [tenants]);

  useEffect(() => {
    if (!PERSISTENT_OWNER_MOBILE_TABS.includes(activeTab)) return;
    setMountedMobileTabs(previous => {
      if (previous.has(activeTab)) return previous;
      const next = new Set(previous);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  useEffect(() => {
    const tenantRows = Array.isArray(tenants) ? tenants.filter(tenant => tenant?.id) : [];
    if (!tenantRows.length) {
      setTenantPhotoUrls({});
      return undefined;
    }

    let cancelled = false;
    const embeddedUrls = Object.fromEntries(
      tenantRows
        .filter(tenant => tenant.profilePhotoUrl)
        .map(tenant => [tenant.id, tenant.profilePhotoUrl])
    );
    if (Object.keys(embeddedUrls).length) {
      setTenantPhotoUrls(current => ({ ...current, ...embeddedUrls }));
    }

    getOwnerTenantProfilePhotoUrls(tenantRows)
      .then(urls => {
        if (!cancelled) setTenantPhotoUrls(current => ({ ...current, ...embeddedUrls, ...(urls || {}) }));
      })
      .catch(() => {
        if (!cancelled && Object.keys(embeddedUrls).length) setTenantPhotoUrls(current => ({ ...current, ...embeddedUrls }));
      });

    return () => { cancelled = true; };
  }, [tenantPhotoSignature, tenants]);

  // ----------------------------------------------------------------
  // FETCH FUNCTIONS FOR HISTORY & PROFILE
  // ----------------------------------------------------------------
  const fetchTenantPayments = async (tenant) => {
    setSelectedTenantForPayments(tenant);
    setShowTenantPaymentsModal(true);
    if (paymentCache.current.has(tenant.id)) { setTenantPayments(paymentCache.current.get(tenant.id)); return; }
    setLoadingPayments(true);
    try {
      const { data, error } = await supabase
        .from('payment_history')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      const payments = data || [];
      paymentCache.current.set(tenant.id, payments);
      setTenantPayments(payments);
    } catch (error) {
      toast.error('Failed to load payment history');
    } finally { setLoadingPayments(false); }
  };

  const fetchTenantApplication = async (tenant) => {
    setSelectedProfileTenant(tenant);
    setShowTenantProfileModal(true);
    if (profileCache.current.has(tenant.id)) {
      const cached = profileCache.current.get(tenant.id);
      setSelectedProfileTenant(cached.tenant);
      setTenantApplication(cached.application);
      setTenantExtraDocuments(cached.extraDocuments || []);
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    try {
      const [tenantResult, paymentHistoryResult] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenant.id).eq('property_id', property.id).single(),
        supabase.from('payment_history')
          .select('id, payment_screenshot, payment_date, payment_method, status')
          .eq('tenant_id', tenant.id)
          .order('payment_date', { ascending: false })
          .limit(10),
      ]);
      if (tenantResult.error) throw tenantResult.error;
      if (paymentHistoryResult.error) throw paymentHistoryResult.error;
      const fullTenant = { ...tenantResult.data, profilePhotoUrl: tenant.profilePhotoUrl || null };
      const { record, source_type } = await findTenantDocumentRecord(fullTenant, property.id);
      const documentRecord = record ? { ...record, source_type } : null;
      const extraDocuments = (paymentHistoryResult.data || [])
        .filter(item => item.payment_screenshot)
        .map((item, index) => ({ label: `Payment receipt ${index + 1}`, record: item, field: 'payment_screenshot' }));
      profileCache.current.set(tenant.id, { tenant: fullTenant, application: documentRecord, extraDocuments });
      setSelectedProfileTenant(fullTenant);
      setTenantApplication(documentRecord);
      setTenantExtraDocuments(extraDocuments);
    } catch (error) {
      toast.error('Could not fetch documents');
    } finally {
      setLoadingProfile(false);
    }
  };

  // ----------------------------------------------------------------
  // FINAL APPROVAL LOGIC (Duplicate phone Check)
  // ----------------------------------------------------------------
  const handleApproveApplication = async (appId, appData) => {
    if (isSubmitting) return;

    if (!appId || !appData) {
      toast.error('Application data is missing.');
      return;
    }

    setIsSubmitting(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.access_token) {
        throw new Error('Your session has expired. Please log in again.');
      }

      const response = await fetch('/api/requests/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          type: 'application',
          id: appId,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'Application approval failed.');
      }

      toast.success(
        result.setupEmailSent
          ? `${appData.name || 'Applicant'} approved and password setup email sent.`
          : `${appData.name || 'Applicant'} approved successfully.`
      );

      if (result.notificationEmailSent === false) {
        toast.warning(
          'Application was approved, but the additional approval notification email was not sent.'
        );
      }

      await loadData({
        background: true,
        force: true,
        reason: 'approve-application-reconciliation',
      });
    } catch (error) {
      console.error('Approve error:', error);
      toast.error(
        'Failed to approve: ' + (error?.message || 'Unknown error')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const getRoomNumberById = (roomId) => { const room = rooms.find(r => r.id === roomId); return room ? room.room_number : 'N/A' }
  const getTenantsInRoom = (roomId) => tenantsWithPhotos.filter(t => t.room_id === roomId)

  const handleCollectRent = async () => {
    if (isSubmitting || !selectedTenant || !collectionRequestId) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Enter a valid collection amount'); return; }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('record_owner_rent_collection', {
        p_tenant_id: selectedTenant.id,
        p_amount: amount,
        p_collection_id: collectionRequestId,
      });
      if (error) throw error;
      await loadData({ background: true, force: true, reason: 'collect-rent-reconciliation' });
      toast.success('Rent collection recorded');
      setShowPaymentModal(false);
      setSelectedTenant(null);
      setPaymentAmount('');
      setCollectionRequestId(null);
    } catch (error) {
      toast.error('Failed to collect rent: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchArchivedTenantHistory = async (tenant) => {
    if (loadingArchivedTenantId) return;
    setLoadingArchivedTenantId(tenant.id);
    setArchivedHistory(null);
    setShowArchivedHistoryModal(true);
    try {
      const { data, error } = await supabase.rpc('get_archived_tenant_history', { p_tenant_id: tenant.id });
      if (error) throw error;
      setArchivedHistory(data);
    } catch (error) {
      toast.error('Failed to load archived tenant history: ' + error.message);
      setShowArchivedHistoryModal(false);
    } finally {
      setLoadingArchivedTenantId(null);
    }
  };

  const openPaymentConfirmation = (tenant) => {
    const pendingPayment = safePendingRentPayments.find(payment => payment.tenant_id === tenant.id);
    if (!pendingPayment) {
      toast.error('This tenant has no payment awaiting confirmation.');
      return;
    }
    setConfirmingTenant({
      ...tenant,
      pendingPaymentId: pendingPayment.id,
      upi_transaction_id: pendingPayment.upi_transaction_id,
      payment_screenshot: pendingPayment.payment_screenshot,
    });
    setShowPaymentConfirmModal(true);
  };

  const handleConfirmPendingPayment = async () => {
    if (isSubmitting || !confirmingTenant?.pendingPaymentId) return;
    setIsSubmitting(true);
    try {
      const confirmed = await confirmRentPayment(confirmingTenant.pendingPaymentId);
      if (confirmed) {
        setShowPaymentConfirmModal(false);
        setConfirmingTenant(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveTenant = async (reason = '') => {
    if (isSubmitting || !tenantToDelete) return;
    if (!String(reason || '').trim()) {
      toast.error('Select a reason before archiving the tenant');
      return;
    }
    setIsSubmitting(true);
    try {
      const data = await archiveOwnerTenant(supabase, tenantToDelete.id, reason);
      if (data?.occupancy_released && data?.room_id) {
        try {
          const convertedReservation = await convertReservedPrebookingForReleasedRoom(supabase, fetch, data.room_id);
          if (convertedReservation) {
            const { response, conversion } = convertedReservation;
            if (response.ok && conversion.converted && conversion.setupEmailSent) toast.success('Reserved pre-booking converted and setup email sent.');
            else if (!response.ok) toast.error(conversion.error || 'Reserved pre-booking conversion failed. You can retry from pre-bookings.');
          }
        } catch (conversionError) {
          toast.error('Reserved pre-booking conversion failed. You can retry from pre-bookings.');
        }
      }
      profileCache.current.delete(tenantToDelete.id);
      paymentCache.current.delete(tenantToDelete.id);
      await loadData({ background: true, force: true, reason: 'archive-tenant-reconciliation' });
      toast.success('Tenant removed from the active room and archived');
      setShowConfirmDeleteModal(false);
      setTenantToDelete(null);
    } catch (error) {
      const rawMessage = String(error?.message || '')
      const safeMessage = /constraint|tenants_status_check|violates/i.test(rawMessage)
        ? 'Tenant archive is not available until the latest database lifecycle migration is applied.'
        : rawMessage || 'Please try again.'
      toast.error('Failed to archive tenant: ' + safeMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateProfilePhotoFile = (file) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) return 'Profile photo must be a JPEG, PNG, or WEBP image.'
    if (file.size > 5 * 1024 * 1024) return 'Profile photo must be under 5MB.'
    return ''
  }

  const uploadProfilePhotoWithSignedUrl = async (endpoint, file, payload = {}) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Please log in again')
    const preparedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...payload, contentType: file.type, size: file.size }),
    })
    const prepared = await preparedResponse.json().catch(() => ({}))
    if (!preparedResponse.ok) throw new Error(prepared.error || 'Could not prepare profile photo upload.')
    const { error } = await supabase.storage.from('tenant-documents').uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type })
    if (error) throw new Error('Profile photo upload failed. Please try again.')
    return prepared.path
  }

  const updateOwnerManagedTenantPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!selectedProfileTenant?.id || !file) return;
    const validationError = validateProfilePhotoFile(file);
    if (validationError) { toast.error(validationError); return; }
    setTenantPhotoUpdating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please log in again');
      const uploadedPath = await uploadProfilePhotoWithSignedUrl('/api/owner/tenant-profile-photo-upload-url', file, { tenantId: selectedProfileTenant.id });
      const updateResponse = await fetch('/api/owner/tenant-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'update', tenantId: selectedProfileTenant.id, path: uploadedPath }),
      });
      const updated = await updateResponse.json().catch(() => ({}));
      if (!updateResponse.ok) throw new Error(updated.error || 'Could not save profile photo');
      clearOwnerTenantProfilePhotoCache();
      setTenantPhotoUrls(current => ({ ...current, [selectedProfileTenant.id]: updated.signedUrl || current[selectedProfileTenant.id] || null }));
      setSelectedProfileTenant(current => ({ ...current, profile_photo_path: uploadedPath, profilePhotoUrl: updated.signedUrl || current?.profilePhotoUrl || null }));
      setTenants(current => current.map(tenant => tenant.id === selectedProfileTenant.id ? { ...tenant, profile_photo_path: uploadedPath, profilePhotoUrl: updated.signedUrl || tenant.profilePhotoUrl || null } : tenant));
      profileCache.current.delete(selectedProfileTenant.id);
      toast.success('Tenant profile photo updated');
    } catch (error) {
      toast.error(error.message || 'Could not update tenant photo');
    } finally {
      setTenantPhotoUpdating(false);
    }
  };

  const uploadOwnerTenantProfilePhoto = async (tenant, file) => {
    if (!tenant?.id || !file) return null
    const validationError = validateProfilePhotoFile(file)
    if (validationError) throw new Error(validationError)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session expired. Please log in again.')
    const uploadedPath = await uploadProfilePhotoWithSignedUrl('/api/owner/tenant-profile-photo-upload-url', file, { tenantId: tenant.id })
    const updateResponse = await fetch('/api/owner/tenant-profile-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'update', tenantId: tenant.id, path: uploadedPath }),
    })
    const updated = await updateResponse.json().catch(() => ({}))
    if (!updateResponse.ok) throw new Error(updated.error || 'Could not save profile photo.')
    clearOwnerTenantProfilePhotoCache()
    setTenantPhotoUrls(current => ({ ...current, [tenant.id]: updated.signedUrl || null }))
    setTenants(current => current.map(row => row.id === tenant.id ? { ...row, profile_photo_path: uploadedPath, profilePhotoUrl: updated.signedUrl || row.profilePhotoUrl || null } : row))
    toast.success('Profile photo updated.')
    return uploadedPath
  }

  const handleArchiveProperty = async () => {
    if (isSubmitting || !property?.id) return;
    const reason = window.prompt(
      'Archive this property?\n\nIt will disappear from Browse Hostels and new public applications will be blocked. Rooms, tenants, payments, requests, and history remain preserved.\n\nReason:'
    );
    if (reason === null) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('archive_property', {
        p_property_id: property.id,
        p_reason: reason.trim() || 'Owner archived property',
      });
      if (error) throw error;
      toast.success('Property archived. Historical records were preserved.');
      await loadData({ background: true, force: true, reason: 'archive-property-reconciliation' });
      openSection('overview');
    } catch (error) {
      toast.error('Failed to archive property: ' + (error.message || 'Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveSettings = async (location) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await saveSettings(settings);
      if (location?.latitude && property?.id) {
        const { error } = await supabase.from('properties').update({
          latitude: location.latitude,
          longitude: location.longitude,
          formatted_address: location.formatted_address || property.address,
          location_place_id: location.location_place_id || null,
          location_verified: false,
        }).eq('id', property.id).eq('owner_id', property.owner_id);
        if (error) throw error;
      }
      toast.success('Settings saved');
      setShowSettingsModal(false);
    } catch (error) {
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveOwnerProfile = async (profileData) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updateOwnerProfile(profileData);
      toast.success('Owner profile updated');
      setShowOwnerProfileModal(false);
    } catch (error) {
      toast.error('Failed to update profile: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRespondToComplaint = async () => {
    if (isSubmitting || !selectedComplaint) return;
    setIsSubmitting(true);
    try {
      const success = await respondToComplaint(selectedComplaint.id, complaintResponse);
      if (success) {
        setShowComplaintResponseModal(false);
        setSelectedComplaint(null);
        setComplaintResponse('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectRoomChange = async () => {
    if (isSubmitting || !selectedRoomChangeRequest) return;
    setIsSubmitting(true);
    try {
      const success = await rejectRoomChange(selectedRoomChangeRequest.id, rejectionReason);
      if (success) {
        setShowRoomChangeReasonModal(false);
        setSelectedRoomChangeRequest(null);
        setRejectionReason('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveRoomChange = async (request) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const approved = await approveRoomChange(request);

      if (approved) {
        await loadData({
          background: true,
          force: true,
          reason: 'approve-room-change-reconciliation',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveVacate = async (requestId, tenantId, expectedDate) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try { await approveVacateRequest(requestId, tenantId, expectedDate); }
    finally { setIsSubmitting(false); }
  };

  const handleResolveComplaint = async (complaintId) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try { await resolveComplaint(complaintId); }
    finally { setIsSubmitting(false); }
  };

  const handleReviewRentPayment = async (paymentId, approve) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      return approve ? await confirmRentPayment(paymentId) : await rejectRentPayment(paymentId);
    } finally { setIsSubmitting(false); }
  };

  const openSignedPaymentScreenshot = async (proof) => {
    const loadingToast = toast.loading('Opening document…')
    try {
      const field = proof?.field || 'payment_screenshot'
      const record = proof?.record || (typeof proof === 'string' ? { payment_screenshot: proof } : proof)
      const sourceRecord = record?.payment_screenshot_url && !record?.payment_screenshot
        ? { ...record, source_type: 'application' }
        : record
      const signed = await signPrivateDocumentFields(sourceRecord, [field])
      const url = signed?.[field] || (field === 'payment_screenshot' ? record?.payment_screenshot_url : null) || null
      if (!url) {
        toast.error('This document is unavailable or has been removed.')
        return
      }
      setScreenshotUrl(url)
      setShowScreenshotModal(true)
    } catch {
      toast.error('This document is unavailable or has been removed.')
    } finally {
      toast.dismiss(loadingToast)
    }
  };

  const openExistingImportDocument = async (item, documentType) => {
    const loadingToast = toast.loading('Opening document...')
    try {
      const url = await openSignedPrivateDocument({ id: item.id, source_type: 'existing_tenant_import' }, documentType)
      if (!url) toast.error('This document is unavailable or has been removed.')
    } catch {
      toast.error('This document is unavailable or has been removed.')
    } finally {
      toast.dismiss(loadingToast)
    }
  };

  const handlePostNotice = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const posted = await postNotice(noticeForm.title, noticeForm.content, noticeForm.type, noticeForm.is_urgent, noticeForm.image_file);
      if (posted) {
        setNoticeForm({ title:'', content:'', type:'general', is_urgent:false, image_file:null });
        setShowNoticeModal(false);
      }
    } finally { setIsSubmitting(false); }
  };

  const safeRooms = useMemo(() => Array.isArray(rooms) ? rooms : [], [rooms])
  const safeTenants = useMemo(() => Array.isArray(tenants) ? tenants : [], [tenants])
  const safeArchivedTenants = useMemo(() => Array.isArray(archivedTenants) ? archivedTenants : [], [archivedTenants])
  const safeAllPayments = useMemo(() => Array.isArray(allPayments) ? allPayments : [], [allPayments])
  const safePendingRentPayments = useMemo(() => Array.isArray(pendingRentPayments) ? pendingRentPayments : [], [pendingRentPayments])
  const safeComplaints = useMemo(() => Array.isArray(complaints) ? complaints : [], [complaints])
  const safeVacateRequests = useMemo(() => Array.isArray(vacateRequests) ? vacateRequests : [], [vacateRequests])
  const safeNotices = useMemo(() => Array.isArray(notices) ? notices : [], [notices])
  const safeRoomChangeRequests = useMemo(() => Array.isArray(roomChangeRequests) ? roomChangeRequests : [], [roomChangeRequests])
  const safeApplications = useMemo(() => Array.isArray(applications) ? applications : [], [applications])
  const safePreBookings = useMemo(() => Array.isArray(preBookings) ? preBookings : [], [preBookings])
  const pendingPreBookings = useMemo(() => safePreBookings.filter(booking => booking.status === 'pending'), [safePreBookings])
  const reservedPreBookings = useMemo(() => safePreBookings.filter(booking => booking.status === 'reserved'), [safePreBookings])
  const reservationCountsByRoom = useMemo(() => reservedPreBookings.reduce((counts, booking) => {
    counts[booking.room_id] = (counts[booking.room_id] || 0) + 1
    return counts
  }, {}), [reservedPreBookings])
  const safeExistingImports = useMemo(() => Array.isArray(existingImports.imports) ? existingImports.imports : [], [existingImports.imports])
  const searchLower = searchTerm.trim().toLowerCase()
  const matchesSearch = useCallback((...values) => !searchLower || values.some(value => String(value ?? '').toLowerCase().includes(searchLower)), [searchLower])
  const getTenantPhotoUrl = useCallback((tenant) => tenantPhotoUrls[tenant?.id] || tenant?.profilePhotoUrl || null, [tenantPhotoUrls])
  const filteredRooms = useMemo(() => safeRooms.filter(room => matchesSearch(room.room_number, room.status, room.sharing_type, room.room_audience)), [safeRooms, matchesSearch])
  const tenantsWithPhotos = useMemo(() => safeTenants.map(tenant => ({ ...tenant, profilePhotoUrl: getTenantPhotoUrl(tenant) })), [safeTenants, getTenantPhotoUrl])
  const searchedTenants = useMemo(() => tenantsWithPhotos.filter(tenant => matchesSearch(tenant.name, tenant.phone, tenant.email, tenant.room_number, tenant.pending_amount, tenant.rent_status, tenant.status, tenant.dueStatus?.status, tenant.rentSummary?.label)), [tenantsWithPhotos, matchesSearch])
  const tenantRentCounts = useMemo(() => summarizeTenantRentStatuses(searchedTenants), [searchedTenants])
  const filteredTenants = useMemo(() => filterTenantsByRentStatus(searchedTenants, tenantRentFilter), [searchedTenants, tenantRentFilter])
  const displayTenants = filteredTenants
  const filteredArchivedTenants = useMemo(() => safeArchivedTenants.filter(tenant => matchesSearch(tenant.name, tenant.phone, tenant.email, tenant.room_number)), [safeArchivedTenants, matchesSearch])
  const attachPaymentTenantPhoto = useCallback(payment => payment?.tenants?.id ? { ...payment, tenants: { ...payment.tenants, profilePhotoUrl: tenantPhotoUrls[payment.tenants.id] || null } } : payment, [tenantPhotoUrls])
  const filteredPendingPayments = useMemo(() => safePendingRentPayments.filter(payment => matchesSearch(payment.tenants?.name, payment.tenants?.phone, payment.tenants?.email, payment.tenants?.rooms?.room_number, payment.amount, payment.status, payment.upi_transaction_id)).map(attachPaymentTenantPhoto), [safePendingRentPayments, matchesSearch, attachPaymentTenantPhoto])
  const filteredAllPayments = useMemo(() => safeAllPayments.filter(payment => matchesSearch(payment.tenants?.name, payment.tenants?.phone, payment.tenants?.email, payment.tenants?.rooms?.room_number, payment.amount, payment.status, payment.payment_method, payment.upi_transaction_id)).map(attachPaymentTenantPhoto), [safeAllPayments, matchesSearch, attachPaymentTenantPhoto])
  const filteredApplications = useMemo(() => safeApplications.filter(application => matchesSearch(application.name, application.phone, application.email, application.status, application.rooms?.room_number, application.payment_transaction_id)), [safeApplications, matchesSearch])
  const filteredExistingImports = useMemo(() => safeExistingImports.filter(item => matchesSearch(item.full_name, item.phone, item.email, item.status, item.room_number, item.occupation)), [safeExistingImports, matchesSearch])
  const filteredPreBookings = useMemo(() => safePreBookings.filter(booking => matchesSearch(booking.name, booking.phone, booking.email, booking.status, booking.room_number, booking.payment_transaction_id)), [safePreBookings, matchesSearch])
  const filteredComplaints = useMemo(() => safeComplaints.filter(complaint => matchesSearch(complaint.tenant_name, complaint.room_number, complaint.title, complaint.description, complaint.priority, complaint.status, complaint.admin_response)), [safeComplaints, matchesSearch])
  const filteredNotices = useMemo(() => safeNotices.filter(notice => matchesSearch(notice.title, notice.content, notice.type)), [safeNotices, matchesSearch])
  const filteredVacateRequests = useMemo(() => safeVacateRequests.filter(request => matchesSearch(request.tenant_name, request.room_number, request.status, request.reason, request.expected_check_out)), [safeVacateRequests, matchesSearch])
  const filteredRoomChangeRequests = useMemo(() => safeRoomChangeRequests.filter(request => matchesSearch(request.tenants?.name, request.tenants?.phone, request.tenants?.email, request.old_room?.room_number, request.new_room?.room_number, request.reason, request.status)), [safeRoomChangeRequests, matchesSearch])
  const getTenantDueAmount = useCallback((tenant) => Number(tenant?.rentSummary?.dueAmount ?? tenant?.dueStatus?.dueAmount ?? tenant?.pending_amount ?? tenant?.rent_amount ?? 0), [])
  const openCollectRent = useCallback((tenant) => {
    const dueAmount = getTenantDueAmount(tenant)
    setSelectedTenant({ ...tenant, pending_amount: dueAmount })
    setPaymentAmount(dueAmount)
    setCollectionRequestId(crypto.randomUUID())
    setShowPaymentModal(true)
  }, [getTenantDueAmount])
  const openSectionStable = useStableCallback(openSection)
  const navigateDashboardBackStable = useStableCallback(navigateDashboardBack)
  const toggleProfileMenu = useCallback(() => setProfileMenuOpen(value => !value), [])
  const openMembershipSection = useCallback(() => openSectionStable('membership'), [openSectionStable])
  const openAddRoomModal = useCallback(() => { if (membershipActive) setShowRoomModal(true) }, [membershipActive])
  const openAddTenantModal = useCallback(() => { if (membershipActive) setShowAddModal(true) }, [membershipActive])
  const openRoomDetails = useCallback((room) => { setSelectedRoom(room); setShowRoomDetailsModal(true) }, [])
  const removeRoom = useCallback((id) => deleteRoom(id, isSubmitting, setIsSubmitting), [deleteRoom, isSubmitting])
  const openTenantDelete = useCallback((tenant) => { setTenantToDelete(tenant); setShowConfirmDeleteModal(true) }, [])
  const confirmPendingPayment = useStableCallback((id) => handleReviewRentPayment(id, true))
  const rejectPendingPayment = useStableCallback((id) => handleReviewRentPayment(id, false))
  const searchGroups = useMemo(() => [
    ['tenants', 'Tenants', filteredTenants.length],
    ['archived-tenants', 'Archived tenants', filteredArchivedTenants.length],
    ['rooms', 'Rooms', filteredRooms.length],
    ['rent-payments', 'Pending payments', filteredPendingPayments.length],
    ['payment-history', 'Payment history', filteredAllPayments.length],
    ['applications', 'Applications', filteredApplications.length],
    ['existing-imports', 'Existing tenant imports', filteredExistingImports.length],
    ['pre-bookings', 'Pre-bookings', filteredPreBookings.length],
    ['complaints', 'Complaints', filteredComplaints.length],
    ['notices', 'Notices', filteredNotices.length],
    ['vacate', 'Vacate requests', filteredVacateRequests.length],
    ['room-change', 'Room changes', filteredRoomChangeRequests.length],
  ].filter(([, , count]) => count > 0), [filteredTenants.length, filteredArchivedTenants.length, filteredRooms.length, filteredPendingPayments.length, filteredAllPayments.length, filteredApplications.length, filteredExistingImports.length, filteredPreBookings.length, filteredComplaints.length, filteredNotices.length, filteredVacateRequests.length, filteredRoomChangeRequests.length])
  const ownerTabs = useMemo(() => [
    ['overview', 'Overview'], ['analytics', 'Analytics'], ['rooms', `Rooms (${safeRooms.length})`], ['tenants', `Tenants (${safeTenants.length})`],
    ['archived-tenants', `Archived (${safeArchivedTenants.length})`], ['rent-payments', `Rent (${safePendingRentPayments.length})`], ['payment-history', 'History'],
    ['pre-bookings', 'Pre-bookings'], ['applications', `Applications (${safeApplications.length})`], ['existing-imports', `Imports (${existingImports.pendingCount})`],
    ['complaints', `Complaints (${safeComplaints.length})`], ['vacate', `Vacate (${safeVacateRequests.filter(request => request.status === 'pending').length})`], ['room-change', `Room change (${safeRoomChangeRequests.length})`], ['notices', `Notices (${safeNotices.length})`], ['membership', 'Membership'],
  ].map(([id, label]) => ({ id, label })), [safeRooms.length, safeTenants.length, safeArchivedTenants.length, safePendingRentPayments.length, safeApplications.length, existingImports.pendingCount, safeComplaints.length, safeVacateRequests, safeRoomChangeRequests.length, safeNotices.length])
  const ownerViewTitle = ownerTabs.find(item => item.id === activeTab)?.label.replace(/ \(.*\)$/, '') || 'Dashboard'
  const ownerBottomItems = useMemo(() => [
    { id: 'overview', label: 'Dashboard', icon: 'dashboard' }, { id: 'rooms', label: 'Rooms', icon: 'rooms' }, { id: 'tenants', label: 'Tenants', icon: 'users' },
    { id: 'rent-payments', label: 'Payments', icon: 'payments' }, { id: 'more', label: 'More', icon: 'more' },
  ], [])
  const ownerSidebarItems = useMemo(() => ownerTabs.map(item => ({ ...item, icon: ({ overview:'dashboard', rooms:'rooms', tenants:'users', 'rent-payments':'payments', 'payment-history':'payments', notices:'notices', complaints:'complaints', analytics:'analytics', membership:'settings' })[item.id] || 'settings', disabled: !membershipActive && !['overview', 'membership'].includes(item.id) })), [ownerTabs, membershipActive])
  const overviewStats = useMemo(() => ({ ...stats, tenantCount: safeTenants.length, activeNotices: safeNotices.length, pendingApplications: safeApplications.length, pendingImports: existingImports.pendingCount, pendingPreBookings: pendingPreBookings.length, totalComplaints: safeComplaints.length, pendingVacate: safeVacateRequests.filter(request => request.status === 'pending').length, pendingRoomChanges: safeRoomChangeRequests.length, pendingRentConfirmations: safePendingRentPayments.length }), [stats, safeTenants.length, safeNotices.length, safeApplications.length, existingImports.pendingCount, pendingPreBookings.length, safeComplaints.length, safeVacateRequests, safeRoomChangeRequests.length, safePendingRentPayments.length])
  const mobileOverviewCounts = useMemo(() => ({ tenants: safeTenants.length, applications: safeApplications.length, imports: existingImports.pendingCount, preBookings: pendingPreBookings.length, complaints: safeComplaints.length, payments: safePendingRentPayments.length, vacate: safeVacateRequests.filter(item => item.status === 'pending').length, roomChanges: safeRoomChangeRequests.length }), [safeTenants.length, safeApplications.length, existingImports.pendingCount, pendingPreBookings.length, safeComplaints.length, safePendingRentPayments.length, safeVacateRequests, safeRoomChangeRequests.length])

  const hasUsableDashboardData = Boolean(property?.id) || safeRooms.length > 0 || safeTenants.length > 0

  if (loading && !hasUsableDashboardData) {
    return <DashboardSkeleton cards={12} />
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-white">
        <nav className="bg-[#1a1a1a] border-b border-orange-500/30 px-6 py-4 flex justify-between items-center text-white">
          <BrandLogo />
          <div className="flex items-center gap-3">
            <ThemeToggle compact />
            <NotificationBell />
            <button onClick={async () => { await signOut(); window.location.replace('/login') }} className="text-red-400 hover:text-red-300 transition">Logout</button>
          </div>
        </nav>
        <div className="text-center py-20">
          <DashboardIcon name="home" className="mx-auto mb-6 h-16 w-16 text-orange-500" />
          <h1 className="text-2xl font-bold mb-4 text-[#1a1a1a]">Welcome to HOSTELSET!</h1>
          <Link href="/owner/register-property" className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-3 rounded-full font-semibold transition shadow-lg">
            Register Your First Property →
          </Link>
        </div>
      </div>
    )
  }

  const logout = async () => { await signOut(); window.location.replace('/login') }
  const overviewImportRows = existingImports.latestPending || []
  const overviewPreBookingRows = [...pendingPreBookings, ...reservedPreBookings].slice(0, 5)
  const RequestQueueRow = ({ item, type }) => {
    const isImport = type === 'import'
    const id = item.id
    const applicant = isImport ? item.full_name : item.name
    const room = item.rooms?.room_number || item.room_number || 'N/A'
    const status = isImport ? String(item.status || '').replaceAll('_', ' ') : item.status
    const amount = isImport ? item.current_rent : item.pre_booking_fee_amount
    const processing = isImport ? existingImports.processingId === id : prebookingProcessingId === id
    const capacity = Number(item.rooms?.capacity || 0)
    const activeReservations = Number(reservationCountsByRoom[item.room_id] || 0)
    const reservationCapacityReached = !isImport && capacity > 0 && activeReservations >= capacity
    return (
      <article className="grid gap-3 border-t border-slate-100 py-3 first:border-t-0 md:grid-cols-[1.35fr_1fr_0.8fr_0.8fr_1.2fr] md:items-center">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{applicant || 'Applicant'}</p>
          <p className="truncate text-xs text-slate-500">{property?.name || 'Property'} - Room {room}</p>
        </div>
        <div className="text-xs text-slate-600">
          <p>{formatDate(item.created_at)}</p>
          <p className="capitalize">{status || 'pending'}</p>
          {!isImport && <p>{activeReservations} of {capacity || 'N/A'} reserved</p>}
        </div>
        <p className="text-sm font-bold text-slate-800">{formatCurrency(amount || 0)}</p>
        <button type="button" onClick={() => openSection(isImport ? 'existing-imports' : 'pre-bookings')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Quick Review</button>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {!isImport && item.status === 'reserved' ? <span className="rounded-lg bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700">Waiting for vacancy</span> : <button type="button" disabled={Boolean(processing) || reservationCapacityReached} onClick={() => isImport ? existingImports.approve(id) : approvePreBooking(id, item)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{processing ? 'Processing...' : reservationCapacityReached ? 'Capacity reached' : (isImport ? 'Approve' : 'Reserve')}</button>}
          {(isImport || item.status === 'pending') && <button type="button" disabled={Boolean(processing)} onClick={() => isImport ? existingImports.reject(id) : rejectPreBooking(id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Reject</button>}
        </div>
      </article>
    )
  }
  const RequestQueue = ({ title, count, rows, type, tab }) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`owner-${type}-queue`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`owner-${type}-queue`} className="font-bold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500">{count} pending request{count === 1 ? '' : 's'}</p>
        </div>
        <button type="button" onClick={() => openSection(tab)} className="rounded-lg border border-orange-200 px-3 py-2 text-sm font-bold text-orange-700 hover:bg-orange-50">View All</button>
      </div>
      {rows.length ? rows.map(item => <RequestQueueRow key={`${type}:${item.id}`} item={item} type={type} />) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No pending requests.</p>}
    </section>
  )
  const renderOwnerOverview = () => (
    <div className="space-y-4 sm:space-y-6">
      <StatsCards stats={overviewStats} onSelect={openSection} />
      <div className="grid gap-4 xl:grid-cols-2">
        <RequestQueue title="Pending Existing Tenant Imports" count={existingImports.pendingCount} rows={overviewImportRows} type="import" tab="existing-imports" />
        <RequestQueue title="Pending Pre-bookings" count={safePreBookings.length} rows={overviewPreBookingRows} type="prebooking" tab="pre-bookings" />
      </div>
      {searchLower && (
        <div className="rounded-xl border border-orange-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Search results for "{searchTerm.trim()}"</p>
          {searchGroups.length ? <div className="flex flex-wrap gap-2">{searchGroups.map(([tab, label, count]) => <button key={tab} onClick={() => openSection(tab)} className="rounded-full bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-100">{label} ({count})</button>)}</div> : <p className="text-sm text-gray-500">No matching dashboard records.</p>}
        </div>
      )}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="owner-quick-actions">
        <div className="mb-3"><h2 id="owner-quick-actions" className="font-bold text-slate-800">Quick actions</h2><p className="text-sm text-slate-500">Manage this property without leaving your current workspace.</p></div>
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-3">
          <button onClick={() => membershipActive && setShowAddModal(true)} disabled={!membershipActive} className={`w-full sm:w-auto px-6 py-2.5 rounded-full text-sm font-semibold transition shadow-md ${membershipActive ? 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}>+ Add Tenant</button>
          <button onClick={() => membershipActive && setShowRoomModal(true)} disabled={!membershipActive} className={`w-full sm:w-auto px-6 py-2.5 rounded-full text-sm font-semibold transition shadow-sm border-2 ${membershipActive ? 'border-orange-300 text-orange-700 hover:bg-orange-50' : 'border-gray-200 text-gray-400 cursor-not-allowed'}`}>+ Add Room</button>
          <button onClick={() => membershipActive && setShowNoticeModal(true)} disabled={!membershipActive} className={`w-full sm:w-auto px-6 py-2.5 rounded-full text-sm font-semibold transition shadow-sm border-2 ${membershipActive ? 'border-orange-300 text-orange-700 hover:bg-orange-50' : 'border-gray-200 text-gray-400 cursor-not-allowed'}`}>+ Notice</button>
          <button onClick={() => router.push('/owner/register-property')} className="w-full rounded-full border-2 border-slate-300 px-6 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 sm:hidden">+ Add Property</button>
        </div>
      </section>
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-800 mb-4">Membership</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div><p className="text-gray-500">Status</p><p className="font-semibold capitalize text-slate-800">{membershipStatus === 'active' ? 'Active' : membershipStatus === 'expired' ? 'Expired' : 'Inactive'}</p></div>
            <div><p className="text-gray-500">Expiry Date</p><p className="font-semibold text-slate-800">{membershipExpiry ? membershipExpiry.toLocaleDateString('en-IN') : 'Not available'}</p></div>
            <div><p className="text-gray-500">Remaining Days</p><p className="font-semibold text-slate-800">{daysLeft == null ? 'Not available' : Math.max(0, daysLeft)}</p></div>
          </div>
        </div>
        <div>
          <h2 className="font-semibold text-slate-800 mb-3">Active Notices</h2>
          <NoticeList notices={safeNotices.slice(0, 5)} onDelete={deleteNotice} onPost={() => setShowNoticeModal(true)} isSubmitting={isSubmitting} />
        </div>
      </div>
    </div>
  )
  const renderOwnerView = (view = activeTab) => {
    switch (view) {
      case 'overview': return renderOwnerOverview()
      case 'analytics': return <OwnerAnalytics rooms={safeRooms} tenants={safeTenants} archivedTenants={safeArchivedTenants} payments={safeAllPayments} pendingPayments={safePendingRentPayments} applications={ownerAnalytics.applications} existingImports={ownerAnalytics.imports} complaints={safeComplaints} notices={safeNotices} vacateRequests={safeVacateRequests} roomChangeRequests={safeRoomChangeRequests} />
      case 'rooms': return <RoomList rooms={filteredRooms} tenants={tenantsWithPhotos} vacateRequests={safeVacateRequests} roomMonthlyIncome={roomMonthlyIncome} onRoomClick={(room) => { setSelectedRoom(room); setShowRoomDetailsModal(true) }} onDeleteRoom={(id) => deleteRoom(id, isSubmitting, setIsSubmitting)} isSubmitting={isSubmitting} />
      case 'tenants': return renderOwnerTenantsView()
      case 'archived-tenants': return <ArchivedTenantList tenants={filteredArchivedTenants} onViewHistory={fetchArchivedTenantHistory} loadingId={loadingArchivedTenantId} />
      case 'rent-payments': return <RentPaymentsList payments={filteredPendingPayments} onConfirm={(id) => handleReviewRentPayment(id, true)} onReject={(id) => handleReviewRentPayment(id, false)} onViewScreenshot={openSignedPaymentScreenshot} isSubmitting={isSubmitting} />
      case 'payment-history': return <PaymentHistoryTable payments={filteredAllPayments} getRoomNumberById={getRoomNumberById} onViewScreenshot={openSignedPaymentScreenshot} />
      case 'pre-bookings': return <PreBookingList bookings={filteredPreBookings} onApprove={(id, data) => approvePreBooking(id, data)} onReject={rejectPreBooking} onConvert={(id, data) => convertReservedPreBooking(id, data)} onViewScreenshot={openSignedPaymentScreenshot} isSubmitting={Boolean(prebookingProcessingId)} />
      case 'applications': return <ApplicationList applications={filteredApplications} onApprove={(id, data) => approveApplication(id, data)} onReject={rejectApplication} onResendEmail={resendPasswordEmail} onViewScreenshot={openSignedPaymentScreenshot} isSubmitting={Boolean(applicationProcessingId)} />
      case 'existing-imports': return <div className="space-y-5"><ExistingTenantImportSettings link={existingImports.link} property={property} busy={existingImports.linkBusy} onGenerate={existingImports.rotateLink} onToggle={existingImports.setLinkEnabled} /><ExistingTenantImportList imports={filteredExistingImports} loading={existingImports.loading} total={existingImports.total} page={existingImports.page} pageSize={existingImports.pageSize} processingId={existingImports.processingId} onApprove={existingImports.approve} onReject={existingImports.reject} onUpdateRentAnswer={existingImports.updateRentAnswer} onPage={existingImports.loadPage} onViewDocument={openExistingImportDocument} /></div>
      case 'complaints': return <ComplaintList complaints={filteredComplaints} onRespond={(complaint) => { setSelectedComplaint(complaint); setComplaintResponse(''); setShowComplaintResponseModal(true) }} onResolve={handleResolveComplaint} isSubmitting={isSubmitting} />
      case 'vacate': return <VacateRequestList requests={filteredVacateRequests} onApprove={handleApproveVacate} onReject={(request) => { setSelectedVacateRequest(request); setVacateRejectionReason(''); }} isSubmitting={isSubmitting || Boolean(vacateRejectingId)} />
      case 'room-change': return <RoomChangeRequestList focusedRequestId={focusedRequestId} requests={filteredRoomChangeRequests} onApprove={handleApproveRoomChange} onReject={(request) => { setSelectedRoomChangeRequest(request); setRejectionReason(''); setShowRoomChangeReasonModal(true) }} isSubmitting={isSubmitting} />
      case 'notices': return <NoticeList notices={filteredNotices} onDelete={deleteNotice} onPost={() => setShowNoticeModal(true)} isSubmitting={isSubmitting} />
      case 'membership': return renderOwnerMembershipView(false)
      default:
        if (process.env.NODE_ENV !== 'production') console.warn(`[OwnerDashboard] No renderer for owner view key: ${view}`)
        return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">This owner section is not available. Please choose another section from the menu.</div>
    }
  }
  const renderOwnerTenantsView = () => (
    <div className="space-y-3">
      <section aria-label="Current cycle tenant summary" className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-4">
        <div><p className="text-[11px] font-bold uppercase text-slate-400">Paid this cycle</p><p className="text-lg font-black text-emerald-700">{tenantRentCounts.paid}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-slate-400">Due today/overdue</p><p className="text-lg font-black text-red-700">{tenantRentCounts.due}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-slate-400">Upcoming</p><p className="text-lg font-black text-orange-700">{tenantRentCounts.upcoming}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-slate-400">Total active tenants</p><p className="text-lg font-black text-slate-900">{tenantRentCounts.total}</p></div>
      </section>
      <div role="tablist" aria-label="Tenant rent filters" className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {[
          ['all', 'All', tenantRentCounts.total],
          ['due', 'Due', tenantRentCounts.due],
          ['pending_confirmation', 'Pending confirmation', tenantRentCounts.pending_confirmation],
          ['paid', 'Paid', tenantRentCounts.paid],
          ['upcoming', 'Upcoming', tenantRentCounts.upcoming],
        ].map(([id, label, count]) => (
          <button key={id} type="button" role="tab" aria-selected={tenantRentFilter === id} onClick={() => setTenantRentFilter(id)} className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${tenantRentFilter === id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
            {label} <span className="ml-1">({count})</span>
          </button>
        ))}
      </div>
      <TenantTable tenants={displayTenants} vacateRequests={safeVacateRequests} onCollect={openCollectRent} onHistory={fetchTenantPayments} onProfile={fetchTenantApplication} onDelete={(tenant) => { setTenantToDelete(tenant); setShowConfirmDeleteModal(true) }} onConfirmPayment={openPaymentConfirmation} isSubmitting={isSubmitting} getRoomNumberById={getRoomNumberById} />
    </div>
  )
  const renderOwnerMembershipView = (mobile = false) => (
    <section className={`${mobile ? 'rounded-3xl border border-white/10 bg-white p-3 shadow-sm' : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'}`} aria-labelledby="owner-membership-title">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-orange-500">Membership</p>
          <h2 id="owner-membership-title" className={`${mobile ? 'text-base' : 'text-lg'} font-black text-slate-900`}>{property?.name || 'Current property'}</h2>
          <p className="mt-1 text-xs text-slate-500">Property access and renewal status.</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${membershipActive ? 'bg-emerald-100 text-emerald-700' : pendingMembershipRequest ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700'}`}>
          {membershipActive ? 'Active' : pendingMembershipRequest ? 'Pending' : membershipStatus === 'expired' ? 'Expired' : 'Inactive'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <dt className="font-bold text-slate-500">Expiry</dt>
          <dd className="mt-1 font-black text-slate-900">{membershipExpiry ? membershipExpiry.toLocaleDateString('en-IN') : 'Not available'}</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <dt className="font-bold text-slate-500">Days left</dt>
          <dd className="mt-1 font-black text-slate-900">{Number.isFinite(daysLeft) ? daysLeft : '—'}</dd>
        </div>
      </dl>
      {pendingMembershipRequest && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-black">Request pending</p>
          <p className="mt-1">Plan {pendingMembershipRequest.plan_id || 'selected'} · {pendingMembershipRequest.requested_at ? new Date(pendingMembershipRequest.requested_at).toLocaleDateString('en-IN') : 'Awaiting admin review'}</p>
          {pendingMembershipRequest.admin_note && <p className="mt-1">Admin note: {pendingMembershipRequest.admin_note}</p>}
        </div>
      )}
      {!pendingMembershipRequest && (
        <button type="button" onClick={() => setShowMembershipModal(true)} disabled={membershipLoading} className="mt-3 h-9 w-full rounded-2xl bg-orange-500 px-3 text-sm font-black text-white shadow-sm disabled:opacity-50 sm:w-auto">
          {membershipLoading ? 'Loading...' : membershipActive ? 'Request renewal' : 'Request membership'}
        </button>
      )}
    </section>
  )
  const ownerMobileMoreItems = [
    { id: 'dashboard', group: 'Management', label: 'Dashboard', onClick: () => openSection('overview') },
    { id: 'rooms', group: 'Management', label: 'Rooms', onClick: () => openSection('rooms') },
    { id: 'tenants', group: 'Management', label: 'Tenants', onClick: () => openSection('tenants') },
    { id: 'archived-tenants', group: 'Management', label: `Archived tenants (${safeArchivedTenants.length})`, onClick: () => openSection('archived-tenants') },
    { id: 'rent-payments', group: 'Management', label: 'Payments', onClick: () => openSection('rent-payments') },
    { id: 'payment-history', group: 'Management', label: 'Payment history', onClick: () => openSection('payment-history') },
    { id: 'applications', group: 'Requests', label: `Applications (${safeApplications.length})`, onClick: () => openSection('applications') },
    { id: 'imports', group: 'Requests', label: `Existing imports (${existingImports.pendingCount})`, onClick: () => openSection('existing-imports') },
    { id: 'pre-bookings', group: 'Requests', label: `Pre-bookings (${safePreBookings.length})`, onClick: () => openSection('pre-bookings') },
    { id: 'complaints', group: 'Requests', label: 'Complaints', onClick: () => openSection('complaints') },
    { id: 'vacate', group: 'Requests', label: 'Vacate requests', onClick: () => openSection('vacate') },
    { id: 'change', group: 'Requests', label: 'Room changes', onClick: () => openSection('room-change') },
    { id: 'notices', group: 'Communication', label: 'Notices', onClick: () => openSection('notices') },
    { id: 'notifications', group: 'Communication', label: 'Notifications', onClick: () => window.dispatchEvent(new Event('hostelset:open-notifications')) },
    { id: 'analytics', group: 'Insights', label: 'Analytics', onClick: () => openSection('analytics') },
    { id: 'membership', group: 'Insights', label: pendingMembershipRequest ? 'Membership pending' : 'Membership', onClick: () => openSection('membership') },
    { id: 'profile', group: 'Account', label: 'Owner profile', onClick: () => setShowOwnerProfileModal(true) },
    { id: 'settings', group: 'Account', label: 'Property settings', onClick: () => setShowSettingsModal(true) },
    { id: 'add-property', group: 'Account', label: 'Add property', onClick: () => router.push('/owner/register-property') },
    { id: 'archive-property', group: 'Account', label: 'Archive property', danger: true, onClick: handleArchiveProperty },
    { id: 'logout', group: 'Account', label: 'Logout', danger: true, onClick: async () => { await signOut(); window.location.replace('/login') } },
  ]
  const ownerViewTitleFor = (view) => ownerTabs.find(item => item.id === view)?.label.replace(/ \(.*\)$/, '') || 'Dashboard'
  const renderOwnerMobileMainTab = (tab, common) => {
    if (tab === 'rooms') return <OwnerMobileRooms {...common} rooms={filteredRooms} tenants={tenantsWithPhotos} onBack={navigateDashboardBackStable} onAddRoom={openAddRoomModal} onRoomClick={openRoomDetails} onDeleteRoom={removeRoom} isSubmitting={isSubmitting} />
    if (tab === 'tenants') return <OwnerMobileTenants {...common} tenants={searchedTenants} onBack={navigateDashboardBackStable} onAddTenant={openAddTenantModal} onCollect={openCollectRent} onHistory={fetchTenantPayments} onTenantProfile={fetchTenantApplication} onDelete={openTenantDelete} onConfirmPayment={openPaymentConfirmation} />
    if (tab === 'rent-payments') return <OwnerMobilePayments {...common} payments={filteredPendingPayments} onBack={navigateDashboardBackStable} onConfirm={confirmPendingPayment} onReject={rejectPendingPayment} onViewScreenshot={openSignedPaymentScreenshot} isSubmitting={isSubmitting} />
    return <OwnerMobileDashboard {...common} stats={stats} counts={mobileOverviewCounts} membershipActive={membershipActive} membershipStatus={membershipStatus} membershipExpiry={membershipExpiry} daysLeft={daysLeft} pendingMembershipRequest={pendingMembershipRequest} onMembership={openMembershipSection} onNavigate={openSectionStable} />
  }
  const renderOwnerMobilePersistentTab = (tab, common) => {
    if (MAIN_OWNER_MOBILE_TABS.includes(tab)) return renderOwnerMobileMainTab(tab, common)
    if (tab === 'membership') {
      return (
        <div className="max-w-full overflow-x-hidden bg-slate-950 pb-[calc(5.1rem_+_env(safe-area-inset-bottom))]">
          <MobileTopbar title="Membership" subtitle={property?.name} isHome={false} onBack={navigateDashboardBackStable} onProfile={toggleProfileMenu} avatar="" fallbackIcon="users" controls={<NotificationBell listenForGlobalOpen />} />
          <main className="mx-auto max-w-md space-y-2 px-3 py-2">{renderOwnerMembershipView(true)}</main>
        </div>
      )
    }
    return (
      <div className="max-w-full overflow-x-hidden bg-slate-950 pb-[calc(5.1rem_+_env(safe-area-inset-bottom))]">
        <MobileTopbar title={ownerViewTitleFor(tab)} subtitle={property?.name} isHome={false} onBack={navigateDashboardBackStable} onProfile={toggleProfileMenu} avatar="" fallbackIcon="users" controls={<NotificationBell listenForGlobalOpen />} />
        <main className="mx-auto max-w-md space-y-2 px-3 py-2">
          {tab === 'notices' && <button type="button" onClick={() => membershipActive && setShowNoticeModal(true)} disabled={!membershipActive || isSubmitting} className="w-full rounded-2xl bg-orange-500 px-3 py-2 text-sm font-black text-white shadow-sm disabled:opacity-50">+ Add Notice</button>}
          {renderOwnerView(tab)}
        </main>
      </div>
    )
  }

  const renderMountedOwnerMobileTabs = (common) => (
    <div className={PERSISTENT_OWNER_MOBILE_TABS.includes(activeTab) ? '' : 'hidden'} data-owner-mobile-mounted-tabs>
      {PERSISTENT_OWNER_MOBILE_TABS.filter(tab => mountedMobileTabs.has(tab) || tab === activeTab).map(tab => (
        <OwnerMobileTabPanel key={tab} tab={tab} active={activeTab === tab}>
          {renderOwnerMobilePersistentTab(tab, common)}
        </OwnerMobileTabPanel>
      ))}
    </div>
  )

  const renderOwnerMobileView = () => {
    const common = { property, avatar: ownerProfile?.full_name?.charAt(0) || 'O', onProfile: toggleProfileMenu }
    const mountedMainTabs = renderMountedOwnerMobileTabs(common)
    if (PERSISTENT_OWNER_MOBILE_TABS.includes(activeTab)) return mountedMainTabs
    return (
      <>
        {mountedMainTabs}
        <div className="max-w-full overflow-x-hidden bg-slate-950 pb-[calc(5.1rem_+_env(safe-area-inset-bottom))]">
          <MobileTopbar title={ownerViewTitle} subtitle={property?.name} isHome={false} onBack={navigateDashboardBackStable} onProfile={toggleProfileMenu} avatar="" fallbackIcon="users" controls={<NotificationBell listenForGlobalOpen />} />
          <main className="mx-auto max-w-md space-y-2 px-3 py-2">
            {activeTab === 'notices' && <button type="button" onClick={() => membershipActive && setShowNoticeModal(true)} disabled={!membershipActive || isSubmitting} className="w-full rounded-2xl bg-orange-500 px-3 py-2 text-sm font-black text-white shadow-sm disabled:opacity-50">+ Add Notice</button>}
            {renderOwnerView()}
          </main>
        </div>
      </>
    )
  }

  return (
    <div className="dashboard-shell min-h-screen max-w-full overflow-x-hidden bg-[#f8f9fa] font-sans">
      {!isDesktopDashboard ? <div>
        {renderOwnerMobileView()}
        <OwnerMobileRoomDetailsSheet
          room={showRoomDetailsModal ? selectedRoom : null}
          tenants={selectedRoom ? getTenantsInRoom(selectedRoom.id) : []}
          onClose={() => setShowRoomDetailsModal(false)}
          onAddTenant={() => { setShowRoomDetailsModal(false); membershipActive && setShowAddModal(true); }}
          onUpdated={async (updated) => { setRooms(current => current.map(room => room.id === updated.id ? updated : room)); setSelectedRoom(updated); await loadData({ background: true, force: true, reason: 'mobile-room-details-reconciliation' }); }}
        />
        <AccountMenu open={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} name={ownerProfile?.full_name || 'Owner'} subtitle={property?.name} avatar="" fallbackIcon="users" actions={[{label:'Edit profile',onClick:()=>setShowOwnerProfileModal(true)},{label:'Property settings',onClick:()=>setShowSettingsModal(true)},{label:'Add property',onClick:()=>router.push('/owner/register-property')},{label:'Archive property',onClick:handleArchiveProperty,danger:true},{label:'Logout',onClick:logout,danger:true}]}/>
        <MobileBottomNav items={ownerBottomItems} activeId={mobileMenu === 'more' ? 'more' : activeTab} onSelect={id => { if (id === 'more') setMobileMenu('more'); else { setMobileMenu(null); openSection(id) } }} />
        <OwnerMobileMore open={mobileMenu === 'more'} subtitle={property?.name} onClose={() => setMobileMenu(null)} items={ownerMobileMoreItems} />
      </div> : null}
      {isDesktopDashboard ? <>
      <DashboardSidebar role="Owner" items={ownerSidebarItems} activeId={activeTab} onSelect={openSection} footer={<div><p className="truncate text-sm font-bold text-white">{property.name}</p><p className="mt-1 text-xs text-slate-400">{membershipActive?'Membership active':'Membership inactive'}</p></div>}/>
      <div className="dashboard-content">
      
      {/* --- NAVBAR (Premium Onyx & Gold) --- */}
      <nav className="dashboard-desktop-header">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo priority />
            <span className="text-xs bg-[#2a2a2a] text-orange-400/90 border border-orange-500/30 px-3 py-1 rounded-full">Owner</span>
          </div>
          <div className="flex items-center justify-end gap-2 sm:gap-3 flex-wrap flex-1 min-w-0">
            <span className={`hidden sm:inline-flex items-center gap-2 text-xs font-semibold ${realtimeConnected ? 'text-emerald-400' : 'text-gray-500'}`}>
              <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
              {realtimeConnected ? 'Live' : 'Connecting'}
            </span>
            <div className="relative order-last w-full sm:w-48 md:w-64 lg:order-none">
              <DashboardIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input type="search" aria-label="Search dashboard" placeholder="Search dashboard..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded-lg border border-gray-700/50 bg-[#2a2a2a] py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 transition focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <button type="button" onClick={() => setShowMembershipModal(true)} disabled={Boolean(pendingMembershipRequest)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold shadow-sm transition ${membershipActive ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-500/30' : pendingMembershipRequest ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-wait' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}>
              {membershipActive ? 'Active' : pendingMembershipRequest ? 'Approval Pending' : 'Request Membership'}
            </button>
            {membershipExpiry && <span className="hidden items-center gap-1.5 rounded-full border border-gray-700/60 bg-[#2a2a2a] px-3 py-1.5 text-xs font-semibold text-gray-300 md:inline-flex"><DashboardIcon name="calendar" className="h-4 w-4" />{membershipExpiry.toLocaleDateString('en-IN')}</span>}
            <button type="button" title="Edit owner profile" onClick={() => setShowOwnerProfileModal(true)} className="rounded-lg px-3 py-1.5 text-gray-400 transition hover:bg-white/5 hover:text-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Edit owner profile"><DashboardIcon name="users" className="h-4 w-4" /></button>
            <button type="button" title="Open property settings" onClick={() => setShowSettingsModal(true)} className="rounded-lg px-3 py-1.5 text-gray-400 transition hover:bg-white/5 hover:text-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Open property settings"><DashboardIcon name="settings" className="h-4 w-4" /></button>
            {properties.length > 1 ? (
              <select aria-label="Current property" value={property.id} onChange={(event) => selectProperty(event.target.value)} className="max-w-48 rounded-lg border border-orange-500/30 bg-[#2a2a2a] px-3 py-1.5 text-sm text-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-500">
                {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            ) : (
              <span className="text-sm hidden md:inline text-orange-300/80">{property.name}</span>
            )}
            <Link href="/owner/register-property" className="rounded-lg border border-orange-500/30 px-3 py-1.5 text-sm font-semibold text-orange-300 hover:bg-white/5">
              + Add Property
            </Link>
            <button type="button" title="Logout" onClick={async () => { await signOut(); window.location.replace('/login') }} className="text-red-400 hover:text-red-300 transition font-medium">Logout</button>
          </div>
        </div>
      </nav>

      <main ref={sectionRef} className="dashboard-main mx-auto min-w-0 scroll-mt-28 px-3 py-5 sm:px-4 sm:py-8">
        {renderOwnerView()}
      </main>
      </div>
      </> : null}

      {/* --- MODALS --- */}
      <AnimatePresence>
        {showPaymentModal && selectedTenant && <CollectRentModal key="collect-rent-modal" tenant={selectedTenant} paymentAmount={paymentAmount} setPaymentAmount={setPaymentAmount} onCollect={handleCollectRent} onCancel={() => { if (!isSubmitting) { setShowPaymentModal(false); setSelectedTenant(null); setPaymentAmount(''); setCollectionRequestId(null); } }} isSubmitting={isSubmitting} getRoomNumberById={getRoomNumberById} />}
        {showConfirmDeleteModal && tenantToDelete && <ConfirmDeleteModal key="confirm-delete-modal" tenant={tenantToDelete} onArchive={handleArchiveTenant} onCancel={() => { if (!isSubmitting) { setShowConfirmDeleteModal(false); setTenantToDelete(null); } }} isSubmitting={isSubmitting} />}
        {showSettingsModal && <SettingsModal key="settings-modal" settings={settings} setSettings={setSettings} property={property} onSave={handleSaveSettings} onCancel={() => setShowSettingsModal(false)} isSubmitting={isSubmitting} />}
        {showAddModal && <AddTenantModal key="add-tenant-modal" formData={formData} setFormData={setFormData} rooms={rooms} onAdd={() => addTenant(isSubmitting, setIsSubmitting)} onCancel={() => setShowAddModal(false)} isSubmitting={isSubmitting} />}
        {showRoomModal && <AddRoomModal key="add-room-modal" roomForm={roomForm} setRoomForm={setRoomForm} sharingTypes={sharingTypes} onAdd={() => addRoom(isSubmitting, setIsSubmitting)} onCancel={() => setShowRoomModal(false)} isSubmitting={isSubmitting} />}
        {showNoticeModal && <PostNoticeModal key="post-notice-modal" noticeForm={noticeForm} setNoticeForm={setNoticeForm} onPost={handlePostNotice} onCancel={() => { if (!isSubmitting) { setShowNoticeModal(false); setNoticeForm({ title:'', content:'', type:'general', is_urgent:false, image_file:null }); } }} isSubmitting={isSubmitting} />}
        {showMembershipModal && <MembershipModal key="membership-modal" onSelectPlan={async (...args) => { const sent = await requestMembership(...args); if (sent) setShowMembershipModal(false); }} onCancel={() => setShowMembershipModal(false)} loading={membershipLoading} pendingRequest={pendingMembershipRequest} />}
        {showOwnerProfileModal && ownerProfile && <OwnerProfileModal key="owner-profile-modal" profile={ownerProfile} onSave={handleSaveOwnerProfile} onCancel={() => setShowOwnerProfileModal(false)} isSubmitting={isSubmitting} />}
        {showArchivedHistoryModal && <ArchivedTenantHistoryModal key="archived-history-modal" history={archivedHistory} loading={Boolean(loadingArchivedTenantId)} onClose={() => { setShowArchivedHistoryModal(false); setArchivedHistory(null); }} />}
        {showComplaintResponseModal && selectedComplaint && <ComplaintResponseModal key="complaint-response-modal" complaint={selectedComplaint} response={complaintResponse} setResponse={setComplaintResponse} onSend={handleRespondToComplaint} onCancel={() => { setShowComplaintResponseModal(false); setSelectedComplaint(null); setComplaintResponse(''); }} isSubmitting={isSubmitting} />}
        {showRoomChangeReasonModal && selectedRoomChangeRequest && <RoomChangeReasonModal key="room-change-reason-modal" reason={rejectionReason} setReason={setRejectionReason} onReject={handleRejectRoomChange} onCancel={() => { setShowRoomChangeReasonModal(false); setSelectedRoomChangeRequest(null); setRejectionReason(''); }} isSubmitting={isSubmitting} />}
        {selectedVacateRequest && <VacateRejectionModal key="vacate-rejection-modal" request={selectedVacateRequest} reason={vacateRejectionReason} setReason={setVacateRejectionReason} onReject={async () => { const rejected = await rejectVacateRequest(selectedVacateRequest.id, vacateRejectionReason); if (rejected) { setSelectedVacateRequest(null); setVacateRejectionReason(''); } }} onCancel={() => { if (!vacateRejectingId) { setSelectedVacateRequest(null); setVacateRejectionReason(''); } }} isSubmitting={Boolean(vacateRejectingId)} />}
        {showPaymentConfirmModal && confirmingTenant && <PaymentConfirmModal key="payment-confirm-modal" tenant={confirmingTenant} onConfirm={handleConfirmPendingPayment} onCancel={() => { if (!isSubmitting) { setShowPaymentConfirmModal(false); setConfirmingTenant(null); } }} isSubmitting={isSubmitting} onViewScreenshot={openSignedPaymentScreenshot} />}
        {isDesktopDashboard && showRoomDetailsModal && selectedRoom && <RoomDetailsModal key="room-details-modal" room={selectedRoom} tenantsInRoom={getTenantsInRoom(selectedRoom.id)} onClose={() => setShowRoomDetailsModal(false)} isSubmitting={isSubmitting} getRoomNumberById={getRoomNumberById} onUpdated={async (updated) => { setRooms(current => current.map(room => room.id === updated.id ? updated : room)); setSelectedRoom(updated); await loadData({ background: true, force: true, reason: 'desktop-room-details-reconciliation' }); }} />}
        
        {/* History Modal */}
        {showTenantPaymentsModal && selectedTenantForPayments && (
          <TenantPaymentsModal
            key="tenant-payments-modal"
            tenant={selectedTenantForPayments}
            payments={tenantPayments}
            loading={loadingPayments}
            onClose={() => setShowTenantPaymentsModal(false)}
            onViewScreenshot={openSignedPaymentScreenshot}
          />
        )}

        {/* Profile Modal */}
        {showTenantProfileModal && selectedProfileTenant && (
          <TenantProfileModal
            key="tenant-profile-modal"
            tenant={selectedProfileTenant}
            application={tenantApplication}
            extraDocuments={tenantExtraDocuments}
            loading={loadingProfile}
            onClose={() => { setShowTenantProfileModal(false); setTenantExtraDocuments([]) }}
            onViewScreenshot={openSignedPaymentScreenshot}
            onProfilePhotoChange={updateOwnerManagedTenantPhoto}
            photoUpdating={tenantPhotoUpdating}
          />
        )}
        {showScreenshotModal && (
          <ScreenshotModal key="screenshot-modal" url={screenshotUrl} onClose={() => { setShowScreenshotModal(false); setScreenshotUrl(''); }} />
        )}
      </AnimatePresence>
    </div>
  )
}
