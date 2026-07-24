import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { supabase, signOut, signPrivateDocumentFields } from '../../lib/supabase'
import toast from 'react-hot-toast'
import BrandLogo from '../../components/BrandLogo'
import NotificationBell from '../../components/common/NotificationBell'
import ThemeToggle from '../../components/common/ThemeToggle'
import { DashboardSkeleton } from '../../components/ui/Skeleton'

// ---------------- MODULAR IMPORTS ----------------
import { useTenant, TenantProvider } from '../../context/TenantContext'
import { useNotices } from '../../hooks/useNotices'
import { useVacate } from '../../hooks/useVacate'
import { useComplaints } from '../../hooks/useComplaints'
import { usePayments } from '../../hooks/usePayments'
import { useRoomChange } from '../../hooks/useRoomChange'
// ------------------------------------------------

import { calculateRentDueStatus, formatCurrency, formatDate, formatRentDueDetail, formatRentDueLabel, getSharingDetails, isPendingRentPayment } from '../../lib/utils'
import { normalizeBloodGroup } from '../../lib/bloodGroups'
import { uploadProfilePhotoWithSignedUrl, validateProfilePhotoFile } from '../../lib/profilePhotos'

// Content Components (static)
import OverviewSection from '../../components/tenant/OverviewSection'
import DashboardSectionNav from '../../components/dashboard/DashboardSectionNav'
import MobileTopbar from '../../components/dashboard/MobileTopbar'
import MobileBottomNav from '../../components/dashboard/MobileBottomNav'
import DashboardMoreMenu from '../../components/dashboard/DashboardMoreMenu'
import DashboardSidebar from '../../components/dashboard/DashboardSidebar'
import DashboardIcon from '../../components/dashboard/DashboardIcon'
import AccountMenu from '../../components/dashboard/AccountMenu'
import { resetDashboardScroll } from '../../lib/dashboardScroll'
import { dashboardPanelProps, prepareDashboardTabFocus } from '../../lib/dashboardFocus'
import { buildDashboardHref, isCanonicalDashboardQuery, pushDashboardHistory, replaceDashboardHistory, resolveDashboardQuery } from '../../lib/dashboardRouting'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import TenantMobileDashboard from '../../components/tenant/mobile/TenantMobileDashboard'
import TenantMobilePayments from '../../components/tenant/mobile/TenantMobilePayments'
import TenantMobileNotices from '../../components/tenant/mobile/TenantMobileNotices'
import TenantMobileRequests from '../../components/tenant/mobile/TenantMobileRequests'
import TenantMobileMore from '../../components/tenant/mobile/TenantMobileMore'

const RoommatesSection = dynamic(() => import('../../components/tenant/RoommatesSection'))
const NoticesSection = dynamic(() => import('../../components/tenant/NoticesSection'))
const ComplaintsSection = dynamic(() => import('../../components/tenant/ComplaintsSection'))
const PaymentsSection = dynamic(() => import('../../components/tenant/PaymentsSection'))

// Lazy-load Modal Components
const PayRentModal = dynamic(() => import('../../components/tenant/modals/PayRentModal'), { ssr: false })
const ComplaintModal = dynamic(() => import('../../components/tenant/modals/ComplaintModal'), { ssr: false })
const VacateModal = dynamic(() => import('../../components/tenant/modals/VacateModal'), { ssr: false })
const ProfileModal = dynamic(() => import('../../components/tenant/modals/ProfileModal'), { ssr: false })
const RoomChangeModal = dynamic(() => import('../../components/tenant/modals/RoomChangeModal'), { ssr: false })
const ScreenshotModal = dynamic(() => import('../../components/tenant/modals/ScreenshotModal'), { ssr: false })

const TENANT_VIEW_KEYS = new Set(['overview', 'requests', 'roommates', 'notices', 'complaints', 'payments', 'room-change', 'vacate'])
const TENANT_PERSISTENT_TABS = ['overview', 'requests', 'roommates', 'notices', 'complaints', 'payments', 'room-change', 'vacate']

function markTenantViewPerf(label, detail = '') {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetTenantPerf') !== '1' || typeof performance === 'undefined') return
  console.info(`[TenantView] ${label}${detail ? ` ${detail}` : ''}`)
}

function TenantAvatar({ src, name, sizeClass = 'h-8 w-8' }) {
  const [imageFailed, setImageFailed] = useState(false)
  if (src && !imageFailed) {
    return <img src={src} alt={name ? `${name} profile photo` : 'Tenant profile photo'} onError={() => setImageFailed(true)} className={`${sizeClass} rounded-full object-cover`} />
  }
  return <div className={`${sizeClass} flex items-center justify-center rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-sm font-bold text-white`}>{name?.charAt(0) || 'U'}</div>
}

function TenantTabPanel({ tab, active, children }) {
  useEffect(() => {
    if (active) markTenantViewPerf('visible-commit', tab)
  }, [active, tab])

  return (
    <section {...dashboardPanelProps('tenant', tab, active)} data-tenant-tab={tab}>
      {children}
    </section>
  )
}

// ---------------- THE ACTUAL DASHBOARD CONTENT ----------------
function TenantDashboardContent() {
  const router = useRouter();

  // ---------------- MODULAR HOOKS ----------------
  const core = useTenant() || {};
  const { tenant, room, property, owner, roommates, profilePhotoUrl, realtimeConnected, roommateVacateAlert, dashboardSnapshot, dashboardSnapshotLoaded, refreshData, setTenant } = core;

  const { notices = [] } = useNotices(tenant, dashboardSnapshot?.notices, dashboardSnapshotLoaded);
  const { existingVacateRequest, lastVacateDecision, vacateLoaded, cancelVacateRequest, cancelBlockedReason: cancelVacateBlockedReason, refreshVacate } = useVacate(tenant, setTenant, dashboardSnapshot?.vacate_requests, dashboardSnapshotLoaded);
  const { complaints = [], submitComplaint: hookSubmitComplaint, deleteComplaint: hookDeleteComplaint } = useComplaints(tenant, dashboardSnapshot?.complaints, dashboardSnapshotLoaded);

  const {
    paymentHistory = [],
    paymentsLoaded,
    paymentLoading,
    ownerUpiId,
    ownerUpiPhone,
    submitPaymentWithProof
  } = usePayments(tenant, refreshData, owner, dashboardSnapshot?.payments, dashboardSnapshot?.owner_settings, dashboardSnapshotLoaded);

  const {
    pendingRoomChangeRequest,
    lastRoomChangeDecision,
    availableRooms = [],
    showRoomChangeModal,
    setShowRoomChangeModal,
    selectedNewRoom,
    setSelectedNewRoom,
    roomChangeReason,
    setRoomChangeReason,
    openRoomChangeModal,
    submitRoomChangeRequest,
    roomChangeSubmitting
  } = useRoomChange(tenant, refreshData, dashboardSnapshot?.pending_room_change, dashboardSnapshot?.last_room_change_decision, dashboardSnapshotLoaded);

  // ----- UI States remaining -----
  const [showComplaintModal, setShowComplaintModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showVacateModal, setShowVacateModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [complaintForm, setComplaintForm] = useState({ title:'', description:'', priority:'medium' })
  const [vacateForm, setVacateForm] = useState({ expected_date:'', reason:'', rating:0, review:'' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['overview']))
  const [mobileMenu, setMobileMenu] = useState(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const sectionRef = useRef(null)
  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])
  const openSection = tab => {
    markTenantViewPerf('tab-click', String(tab))
    const nextTab = TENANT_VIEW_KEYS.has(tab) ? tab : 'overview'
    if (nextTab !== tab && process.env.NODE_ENV !== 'production') {
      console.warn('[HostelSet] Unknown tenant dashboard view key:', tab)
    }
    if (nextTab !== tab) {
      replaceDashboardHistory(router, buildDashboardHref('tenant', 'overview', router.query))
      setActiveTab('overview')
      setMobileMenu(null); setProfileMenuOpen(false); resetDashboardScroll()
      return
    }
    if (!router.isReady || nextTab === activeTab) {
      setMobileMenu(null); setProfileMenuOpen(false)
      return
    }
    const href = buildDashboardHref('tenant', nextTab, router.query)
    markTenantViewPerf('set-activeTab', nextTab)
    prepareDashboardTabFocus('tenant', activeTabRef.current, nextTab)
    setActiveTab(nextTab)
    setMobileMenu(null); setProfileMenuOpen(false); setShowComplaintModal(false); setShowPaymentModal(false); setShowVacateModal(false); setShowProfileModal(false); setShowRoomChangeModal(false); setShowScreenshotModal(false); resetDashboardScroll()
    window.requestAnimationFrame?.(() => pushDashboardHistory(router, href)) || pushDashboardHistory(router, href)
  }
  const navigateDashboardBack = () => {
    setMobileMenu(null); setProfileMenuOpen(false)
    if (activeTab !== 'overview') {
      replaceDashboardHistory(router, buildDashboardHref('tenant', 'overview', router.query))
      prepareDashboardTabFocus('tenant', activeTabRef.current, 'overview')
      setActiveTab('overview')
      resetDashboardScroll()
      return
    }
    router.back()
  }
  const [editProfile, setEditProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ name:'', phone:'', email:'', blood_group:'' })
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('')
  const [ratingHover, setRatingHover] = useState(0)
  const [paymentScreenshot, setPaymentScreenshot] = useState(null)
  const [paymentTransactionId, setPaymentTransactionId] = useState('')
  const [showScreenshotModal, setShowScreenshotModal] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState('')

  useEffect(() => () => {
    if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview)
  }, [profilePhotoPreview])
  const hasOpenOverlay = showComplaintModal || showPaymentModal || showVacateModal || showProfileModal || showRoomChangeModal || showScreenshotModal || profileMenuOpen || Boolean(mobileMenu)
  useBodyScrollLock(hasOpenOverlay)

  useEffect(() => {
    if (!router.isReady) return
    const resolved = resolveDashboardQuery('tenant', router.query)
    if (!isCanonicalDashboardQuery('tenant', router.query)) {
      replaceDashboardHistory(router, buildDashboardHref('tenant', resolved.view, router.query))
      prepareDashboardTabFocus('tenant', activeTabRef.current, resolved.view)
      setActiveTab(resolved.view)
      setMobileMenu(null)
      resetDashboardScroll()
      return
    }
    if (activeTabRef.current !== resolved.view) {
      resetDashboardScroll()
      prepareDashboardTabFocus('tenant', activeTabRef.current, resolved.view)
    }
    setActiveTab(resolved.view)
    setMobileMenu(null)
  }, [router.isReady, router.query.tab, router.query.payment_id, router.query.notice_id, router.query.complaint_id, router.query.request_id])

  useEffect(() => {
    if (!TENANT_VIEW_KEYS.has(activeTab)) return
    setMountedTabs(previous => {
      if (previous.has(activeTab)) return previous
      const next = new Set(previous)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

  // ----- Helper Functions -----
  const copyPaymentDetail = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied!`)
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}. Please copy it manually.`)
    }
  }
  const copyUpiId = (upiId) => copyPaymentDetail(upiId, 'UPI ID')
  const copyUpiPhone = (phone) => copyPaymentDetail(phone, 'UPI phone number')

  const submitRentPaymentProof = async () => {
    const submitted = await submitPaymentWithProof(paymentScreenshot, paymentTransactionId)
    if (submitted) {
      setPaymentScreenshot(null)
      setPaymentTransactionId('')
      setShowPaymentModal(false)
    }
  }

  const openSignedPaymentScreenshot = async (payment) => {
    const loadingToast = toast.loading('Opening document…')
    try {
      const record = typeof payment === 'string' ? { payment_screenshot: payment } : payment
      const signed = await signPrivateDocumentFields(record, ['payment_screenshot'])
      const url = signed?.payment_screenshot || null
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
  }

  // ----- Profile -----
  const openProfile = () => {
    if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview)
    setProfileForm({ name: tenant?.name || '', phone: tenant?.phone || '', email: tenant?.email || '', blood_group: tenant?.blood_group || '' })
    setProfilePhotoPreview('')
    setEditProfile(false)
    setShowProfileModal(true)
  }

  const handleProfilePhotoChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const validationError = validateProfilePhotoFile(file)
    if (validationError) { toast.error(validationError); return }
    if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview)
    setProfilePhotoPreview(URL.createObjectURL(file))
    setProfileForm(current => ({ ...current, profilePhotoFile: file }))
  }

  const uploadTenantProfilePhoto = async (file) => {
    const { data: { session } } = await supabase.auth.getSession()
    const uploadedPath = await uploadProfilePhotoWithSignedUrl('/api/tenant/profile-photo', file)
    const updateResponse = await fetch('/api/tenant/profile-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ action: 'update', path: uploadedPath }),
    })
    const updated = await updateResponse.json().catch(() => ({}))
    if (!updateResponse.ok) throw new Error(updated.error || 'Could not update profile photo')
    return { uploadedPath, signedUrl: updated.signedUrl || null }
  }

  const updateProfile = async () => {
    if (isSubmitting) return
    if (!profileForm.name) { toast.error('Name is required'); return }
    if (!normalizeBloodGroup(profileForm.blood_group)) { toast.error('Blood group is required'); return }
    setIsSubmitting(true)
    try {
      const { error } = await supabase.rpc('update_tenant_profile', { p_name:profileForm.name, p_phone:profileForm.phone, p_blood_group:normalizeBloodGroup(profileForm.blood_group) })
      if (error) throw error
      const photo = profileForm.profilePhotoFile ? await uploadTenantProfilePhoto(profileForm.profilePhotoFile) : null
      setTenant(current => current ? { ...current, name: profileForm.name, phone: profileForm.phone, blood_group: normalizeBloodGroup(profileForm.blood_group), ...(photo?.uploadedPath ? { profile_photo_path: photo.uploadedPath } : {}) } : current)
      toast.success('Profile updated successfully!')
      setEditProfile(false)
      setProfilePhotoPreview('')
    } catch (error) { toast.error(error.message || 'Failed to update profile') }
    finally { setIsSubmitting(false) }
  }

  // ----- Handlers -----
  const submitComplaint = async () => {
    if (isSubmitting) return
    if (!complaintForm.title || !complaintForm.description) { toast.error('Please fill all fields'); return }
    setIsSubmitting(true)
    const success = await hookSubmitComplaint(complaintForm);
    if (success) {
      setShowComplaintModal(false);
      setComplaintForm({ title:'', description:'', priority:'medium' });
    }
    setIsSubmitting(false);
  };

  const deleteComplaint = async (complaintId) => {
    await hookDeleteComplaint(complaintId);
  };

  const requestVacate = async () => {
    if (isSubmitting) return
    if (vacateBlockedReason) { toast.error(vacateBlockedReason); return }
    if (!vacateForm.expected_date) { toast.error('Please select expected check-out date'); return }
    if (vacateForm.rating === 0) { toast.error('Please rate your experience (1-5 stars)'); return }
    setIsSubmitting(true)
    try {
      const { error } = await supabase.rpc('request_tenant_vacate', {
        p_expected_check_out: vacateForm.expected_date,
        p_reason: vacateForm.reason || null,
        p_rating: vacateForm.rating,
        p_review: vacateForm.review || null
      })
      if (error) throw new Error(error.message)
      toast.success('Vacate request submitted! Owner will review it.')
      await refreshVacate()
      setShowVacateModal(false)
      setVacateForm({ expected_date:'', reason:'', rating:0, review:'' })
    } catch (error) {
      console.error('Vacate request error:', error)
      toast.error('Failed to submit vacate request: ' + error.message)
    } finally { setIsSubmitting(false) }
  }

  const getRentStatus = () => {
    if (!tenant) {
      return {
        status: 'loading',
        message: '',
        daysUntilDue: null,
        dueDate: null,
        dueAmount: 0
      }
    }

    const calculatedStatus = calculateRentDueStatus(tenant, paymentHistory)
    const databasePendingAmount = Math.max(
      Number(tenant.pending_amount || 0),
      0
    )

    if (databasePendingAmount <= 0) {
      return calculatedStatus
    }

    const databaseStatus = String(tenant.rent_status || '').toLowerCase()
    const reconciledStatus =
      databaseStatus === 'overdue'
        ? 'overdue'
        : calculatedStatus?.status === 'paid'
          ? 'pending'
          : calculatedStatus?.status || 'pending'

    return {
      ...calculatedStatus,
      status: reconciledStatus,
      dueAmount: databasePendingAmount,
      currentCycleDueAmount: databasePendingAmount,
      isFullyUpToDate: false,
      paidForCurrentCycle: false,
      currentCyclePaid: false,
      urgent:
        reconciledStatus === 'overdue' ||
        reconciledStatus === 'due_today' ||
        reconciledStatus === 'due_soon',
      message:
        reconciledStatus === 'overdue'
          ? calculatedStatus?.status === 'overdue'
            ? calculatedStatus.message
            : 'Rent overdue'
          : calculatedStatus?.status === 'paid'
            ? 'Payment pending'
            : calculatedStatus?.message || 'Payment pending'
    }
  }

  const rentStatus = getRentStatus() || { message: 'Loading...', dueAmount: 0 }
  const isUrgent = rentStatus.urgent && ['due_soon', 'due_today', 'overdue', 'pending_confirmation'].includes(rentStatus.status)
  const hasPaymentAwaitingApproval = rentStatus.status === 'pending_confirmation' || paymentHistory.some(isPendingRentPayment)
  const hasOutstandingRent = rentStatus.status !== 'paid' && rentStatus.status !== 'inactive' && Number(rentStatus.dueAmount || 0) > 0
  const canPayRent = paymentsLoaded && !hasPaymentAwaitingApproval && hasOutstandingRent
  const paymentActionLabel = hasPaymentAwaitingApproval
    ? 'Approval pending'
    : canPayRent
      ? 'Pay rent'
      : 'Rent paid'

  const openPaymentModal = () => {
    if (!canPayRent) {
      if (hasPaymentAwaitingApproval) {
        toast.error('Your payment is awaiting owner approval.')
      } else {
        toast.error('No rent payment is currently due.')
      }
      return
    }

    setShowPaymentModal(true)
  }

  const tenantWithRentSummary = { ...tenant, pending_amount: rentStatus.dueAmount || 0, rentSummary: rentStatus, dueStatus: rentStatus }
  const vacateBlockedReason = !vacateLoaded || !paymentsLoaded
    ? 'Checking vacate eligibility...'
    : existingVacateRequest
      ? 'You already have an active vacate request.'
      : hasPaymentAwaitingApproval
        ? 'Your latest payment is awaiting owner verification.'
        : hasOutstandingRent
          ? 'Outstanding rent must be cleared before requesting vacate.'
          : null

  const handleLogout = async () => {
    await signOut();
    window.location.replace('/login');
  }

  if (!tenant) {
    return <DashboardSkeleton cards={6} />
  }

  const tenantViewTitle = ({ overview: 'Dashboard', requests: 'Requests', roommates: 'Roommates', notices: 'Notices', complaints: 'Complaints', payments: 'Payments', 'room-change': 'Room change', vacate: 'Vacate request' })[activeTab] || 'Dashboard'
  const tenantBottomItems = [
    { id: 'overview', label: 'Home', icon: 'home' }, { id: 'payments', label: 'Payments', icon: 'payments' }, { id: 'notices', label: 'Notices', icon: 'notices' },
    { id: 'requests', label: 'Requests', icon: 'requests' }, { id: 'more', label: 'More', icon: 'more' },
  ]
  const tenantBottomIcons = { overview:'home', payments:'payments', notices:'notices', requests:'requests', more:'more' }; tenantBottomItems.forEach(item => { item.icon = tenantBottomIcons[item.id] })
  const tenantSidebarItems = [{id:'overview',label:'Dashboard',icon:'dashboard'},{id:'payments',label:'Payments',icon:'payments'},{id:'notices',label:'Notices',icon:'notices'},{id:'requests',label:'Requests',icon:'requests'},{id:'complaints',label:'Complaints',icon:'complaints'},{id:'roommates',label:'Roommates',icon:'users'}]
  const tenantMobileMoreItems = [
    { id: 'home', group: 'Main', label: 'Home', onClick: () => openSection('overview') },
    { id: 'payments', group: 'Main', label: 'Payments', onClick: () => openSection('payments') },
    { id: 'notices', group: 'Main', label: 'Notices', onClick: () => openSection('notices') },
    { id: 'notifications', group: 'Main', label: 'Notifications', onClick: () => window.dispatchEvent(new Event('hostelset:open-notifications')) },
    { id: 'complaints', group: 'Requests', label: 'Complaints', onClick: () => openSection('complaints') },
    { id: 'room-change', group: 'Requests', label: 'Room change', onClick: () => openSection('room-change') },
    { id: 'vacate', group: 'Requests', label: 'Vacate', onClick: () => openSection('vacate') },
    { id: 'profile', group: 'Account', label: 'My profile', onClick: openProfile },
    { id: 'roommates', group: 'Account', label: 'Roommates', onClick: () => openSection('roommates') },
    { id: 'logout', group: 'Account', label: 'Logout', danger: true, onClick: handleLogout },
  ]
  const tenantMobileRequestItems = [
    { id: 'complaints', group: 'Requests', label: 'My complaints', onClick: () => openSection('complaints') },
    { id: 'raise', group: 'Requests', label: 'Raise complaint', onClick: () => setShowComplaintModal(true) },
    { id: 'roommates', group: 'Requests', label: 'Roommate details', onClick: () => openSection('roommates') },
    { id: 'room-change', group: 'Requests', label: pendingRoomChangeRequest ? 'Room change pending' : 'Request room change', onClick: () => openSection('room-change') },
    { id: 'vacate', group: 'Requests', label: existingVacateRequest ? 'View vacate status' : 'Request vacate', onClick: () => openSection('vacate') },
  ]
  const renderRequestsOverview = () => {
    const cards = [
      {
        id: 'complaints',
        icon: 'complaints',
        title: 'Complaints',
        count: complaints?.length || 0,
        description: complaints?.length ? 'View complaint history and status updates.' : 'Raise and track maintenance or service issues.',
        action: complaints?.length ? 'View complaints' : 'Raise complaint',
      },
      {
        id: 'room-change',
        icon: 'requests',
        title: 'Room change',
        count: pendingRoomChangeRequest ? 1 : 0,
        description: pendingRoomChangeRequest ? 'Your room-change request is awaiting owner approval.' : 'Request a move to another eligible room.',
        action: pendingRoomChangeRequest ? 'View request' : 'Request room change',
      },
      {
        id: 'vacate',
        icon: 'home',
        title: 'Vacate',
        count: existingVacateRequest ? 1 : 0,
        description: existingVacateRequest ? `Your vacate request is ${existingVacateRequest.status}.` : (vacateBlockedReason || 'Submit a planned checkout request when eligible.'),
        action: existingVacateRequest ? 'View status' : 'Open vacate',
      },
    ]

    return (
      <section aria-labelledby="tenant-requests-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 id="tenant-requests-title" className="text-lg font-bold text-slate-900">Requests</h2>
          <p className="text-sm text-slate-500">Open complaints, room-change, or vacate workflows from one place.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {cards.map(card => (
            <button key={card.id} type="button" onClick={() => openSection(card.id)} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-orange-200 hover:bg-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-orange-600 shadow-sm"><DashboardIcon name={card.icon} className="h-4 w-4" /></span>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">{card.count} active</span>
              </div>
              <h3 className="text-sm font-bold text-slate-900">{card.title}</h3>
              <p className="mt-1 min-h-[2.5rem] text-xs leading-5 text-slate-600">{card.description}</p>
              <span className="mt-3 inline-flex text-xs font-bold text-orange-600">{card.action}</span>
            </button>
          ))}
        </div>
      </section>
    )
  }
  const renderTenantMobileTab = (tab) => {
    const common = { property, avatar: tenant?.name?.charAt(0) || 'U', avatarUrl: profilePhotoUrl, avatarAlt: tenant?.name ? `${tenant.name} profile photo` : 'Tenant profile photo', onProfile: openProfile, onBack: navigateDashboardBack }
    if (tab === 'payments') return <TenantMobilePayments {...common} payments={paymentHistory} canPayRent={canPayRent} paymentActionLabel={paymentActionLabel} onPayRent={openPaymentModal} onViewScreenshot={openSignedPaymentScreenshot} />
    if (tab === 'notices') return <TenantMobileNotices {...common} notices={notices} />
    if (['complaints', 'room-change', 'vacate', 'roommates'].includes(tab)) return <TenantMobileRequests {...common} view={tab} complaints={complaints} roommates={roommates} room={room} onDeleteComplaint={deleteComplaint} onRaiseComplaint={() => setShowComplaintModal(true)} isSubmitting={isSubmitting} pendingRoomChangeRequest={pendingRoomChangeRequest} onRoomChange={openRoomChangeModal} existingVacateRequest={existingVacateRequest} vacateBlockedReason={vacateBlockedReason} cancelVacateBlockedReason={cancelVacateBlockedReason} onVacate={() => setShowVacateModal(true)} onCancelVacate={cancelVacateRequest} />
    return <TenantMobileDashboard tenant={tenantWithRentSummary} room={room} property={property} roommates={roommates} notices={notices} complaints={complaints} rentStatus={rentStatus} existingVacateRequest={existingVacateRequest} pendingRoomChangeRequest={pendingRoomChangeRequest} avatar={tenant?.name?.charAt(0) || 'U'} avatarUrl={profilePhotoUrl} avatarAlt={tenant?.name ? `${tenant.name} profile photo` : 'Tenant profile photo'} onProfile={openProfile} onNavigate={openSection} canPayRent={canPayRent} paymentActionLabel={paymentActionLabel} onPayRent={openPaymentModal} />
  }
  const renderMountedTenantMobileTabs = () => (
    <div data-tenant-mobile-mounted-tabs>
      {TENANT_PERSISTENT_TABS.filter(tab => mountedTabs.has(tab) || tab === activeTab).map(tab => (
        <TenantTabPanel key={tab} tab={tab} active={activeTab === tab}>
          {renderTenantMobileTab(tab)}
        </TenantTabPanel>
      ))}
    </div>
  )
  const renderTenantDesktopTab = (tab) => {
    if (tab === 'overview') {
      return (
        <OverviewSection
          tenant={tenant}
          room={room}
          property={property}
          owner={owner}
          pendingRoomChangeRequest={pendingRoomChangeRequest}
          lastRoomChangeDecision={lastRoomChangeDecision}
          vacateRequest={existingVacateRequest}
          lastVacateDecision={lastVacateDecision}
        />
      )
    }
    if (tab === 'roommates') return <RoommatesSection roommates={roommates} room={room} />
    if (tab === 'notices') return <NoticesSection notices={notices} />
    if (tab === 'requests') return renderRequestsOverview()
    if (tab === 'complaints') {
      return (
        <ComplaintsSection
          complaints={complaints}
          onDelete={deleteComplaint}
          isSubmitting={isSubmitting}
          onRaiseComplaint={() => setShowComplaintModal(true)}
        />
      )
    }
    if (tab === 'payments') return <PaymentsSection payments={paymentHistory} onViewScreenshot={openSignedPaymentScreenshot} />
    if (tab === 'room-change') return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-900">Room change</h2><p className="mt-2 text-sm text-slate-600">{pendingRoomChangeRequest ? 'Your room-change request is awaiting approval.' : 'Request a move to another available room.'}</p><button type="button" onClick={openRoomChangeModal} disabled={isSubmitting || Boolean(pendingRoomChangeRequest)} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto">{pendingRoomChangeRequest ? 'Request pending' : 'Choose a room'}</button></section>
    if (tab === 'vacate') return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-900">Vacate request</h2><p className="mt-2 text-sm text-slate-600">{existingVacateRequest ? `Your request is ${existingVacateRequest.status}.` : (vacateBlockedReason || 'Submit a planned checkout request to your owner.')}</p>{existingVacateRequest ? <><button type="button" onClick={cancelVacateRequest} disabled={isSubmitting || Boolean(cancelVacateBlockedReason)} className="mt-5 w-full rounded-xl border border-amber-300 px-4 py-3 font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{cancelVacateBlockedReason ? 'Cancellation unavailable' : 'Cancel request'}</button>{cancelVacateBlockedReason && <p className="mt-2 text-sm font-semibold text-amber-700">{cancelVacateBlockedReason}</p>}</> : <button type="button" onClick={() => setShowVacateModal(true)} disabled={isSubmitting || Boolean(vacateBlockedReason)} className="mt-5 w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto">Request vacate</button>}</section>
    return null
  }
  const renderMountedTenantDesktopTabs = () => (
    <>
      {TENANT_PERSISTENT_TABS.filter(tab => mountedTabs.has(tab) || tab === activeTab).map(tab => (
        <TenantTabPanel key={tab} tab={tab} active={activeTab === tab}>
          {renderTenantDesktopTab(tab)}
        </TenantTabPanel>
      ))}
    </>
  )

  return (
    <div className="dashboard-shell min-h-screen max-w-full overflow-x-hidden bg-[#f8f9fa] font-sans">
      <div className="lg:hidden">
        {renderMountedTenantMobileTabs()}
        <MobileBottomNav items={tenantBottomItems} activeId={mobileMenu === 'more' ? 'more' : mobileMenu === 'requests' || ['complaints', 'room-change', 'vacate', 'roommates'].includes(activeTab) ? 'requests' : activeTab} onSelect={id => { if (id === 'requests' || id === 'more') setMobileMenu(id); else { setMobileMenu(null); openSection(id) } }} />
        <TenantMobileMore open={mobileMenu === 'requests'} title="Requests" subtitle={property?.name} onClose={() => setMobileMenu(null)} items={tenantMobileRequestItems} />
        <TenantMobileMore open={mobileMenu === 'more'} title="Tenant menu" subtitle={property?.name} onClose={() => setMobileMenu(null)} items={tenantMobileMoreItems} />
      </div>
      <DashboardSidebar role="Tenant" items={tenantSidebarItems} activeId={activeTab} onSelect={openSection} footer={<div><p className="truncate text-sm font-bold text-white">{property?.name}</p><p className="mt-1 text-xs text-slate-400">Room {room?.room_number || '?'}</p></div>}/>

      {/* --- NAVBAR (Premium Onyx & Gold) --- */}
      <nav className="dashboard-desktop-header">
        <div className="container mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo priority />
            <span className="text-xs bg-[#2a2a2a] text-orange-400/90 border border-orange-500/30 px-3 py-1 rounded-full">Tenant</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className={`hidden sm:inline-flex items-center gap-2 text-xs font-semibold ${realtimeConnected ? 'text-emerald-400' : 'text-gray-500'}`}>
              <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
              {realtimeConnected ? 'Live' : 'Connecting'}
            </span>
            <button type="button" onPointerEnter={() => ProfileModal.preload?.()} onFocus={() => ProfileModal.preload?.()} onClick={openProfile} aria-label="Open my profile" className="flex items-center gap-2 text-gray-400 hover:text-orange-400 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 rounded-lg">
              <TenantAvatar src={profilePhotoUrl} name={tenant?.name} />
              <span className="text-sm hidden md:inline font-medium text-orange-300/80">{tenant?.name}</span>
            </button>
            <ThemeToggle compact />
            <NotificationBell />
            <button onClick={handleLogout} className="text-red-400 hover:text-red-300 transition font-medium">Logout</button>
          </div>
        </div>
      </nav>

      <main className="dashboard-main container mx-auto hidden min-w-0 px-3 py-5 sm:px-4 sm:py-8 lg:block">

        {/* --- WELCOME SECTION (GLASSMORPHISM) --- */}
        {activeTab === 'overview' && <div className="relative mb-3 overflow-hidden rounded-2xl border border-orange-500/20 bg-[#1a1a1a] p-3 shadow-xl sm:mb-8 sm:p-8">
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-orange-500/10 to-transparent rounded-full -mr-20 -mt-20 pointer-events-none" />
          <div className="flex justify-between items-start flex-wrap gap-4 relative z-10">
            <div>
              <h2 className="mb-1 text-base font-bold text-white sm:mb-2 sm:text-3xl">Welcome, <span className="text-orange-400">{tenant?.name}</span></h2>
              <p className="text-xs text-white/70 sm:text-base">Room {room?.room_number} / {getSharingDetails(room?.sharing_type)?.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-white/50 sm:mt-1 sm:text-sm">{property?.name}</p>
            </div>
            <div className={`rounded-full px-2.5 py-1 text-xs font-bold shadow-lg backdrop-blur-sm sm:px-5 sm:py-2.5 sm:text-sm ${isUrgent ? 'bg-red-500/90 text-white animate-pulse border border-red-400' : 'bg-white/10 text-white border border-white/20'}`}>
              {formatRentDueLabel(rentStatus)}
            </div>
          </div>
          {(rentStatus.currentCycleDueDate || rentStatus.nextDueDate || rentStatus.dueDate) && (
            <div className="mt-4 text-center relative z-10">
              <div className="inline-block bg-black/40 backdrop-blur-sm px-5 py-2.5 rounded-lg text-orange-400 font-bold border border-orange-500/30">
                {formatRentDueDetail(rentStatus, formatDate)}
              </div>
            </div>
          )}
        </div>}

        {/* Roommate Vacate Alert */}
        {activeTab === 'overview' && roommateVacateAlert && (
          <div className="bg-orange-500/10 border-l-4 border-orange-500 text-orange-400 p-4 mb-6 rounded-lg shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <DashboardIcon name="home" className="h-5 w-5 shrink-0" />
              <div className="font-medium">
                <strong>Vacate Notice:</strong> {roommateVacateAlert.name} will vacate in <strong>{roommateVacateAlert.daysLeft}</strong> days (by {formatDate(roommateVacateAlert.date)}).
              </div>
            </div>
          </div>
        )}

        {/* --- STATS CARDS (PREMIUM GLASS) --- */}
        {activeTab === 'overview' && <section aria-labelledby="tenant-summary-title" className="mb-3 sm:mb-8"><div className="mb-2 sm:mb-3"><h2 id="tenant-summary-title" className="text-sm font-bold text-slate-900 sm:text-lg">Account summary</h2><p className="hidden text-sm text-slate-500 sm:block">Rent, requests, and activity at a glance.</p></div><div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
          <button type="button" onClick={() => openSection('payments')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-orange-100/50 flex items-center justify-center text-base sm:text-xl text-orange-600"><DashboardIcon name="payments" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Monthly Rent</p>
              <p className="text-base sm:text-xl font-bold text-gray-800 truncate">{formatCurrency(tenant?.rent_amount)}</p>
              {tenant?.scheduled_rent_amount != null &&
                tenant?.scheduled_rent_effective_period &&
                Number(tenant.scheduled_rent_amount) !== Number(tenant.rent_amount) && (
                  <p className="mt-1 text-[10px] font-semibold leading-tight text-orange-600 sm:text-xs">
                    Changes to {formatCurrency(tenant.scheduled_rent_amount)} from{' '}
                    {formatDate(tenant.scheduled_rent_effective_period)}
                  </p>
                )}
            </div>
          </button>
          <button type="button" onClick={() => openSection('payments')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-emerald-100/50 flex items-center justify-center text-base sm:text-xl text-emerald-600"><DashboardIcon name="payments" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Total Paid</p>
              <p className="text-base sm:text-xl font-bold text-emerald-600 truncate">{formatCurrency(tenant?.total_paid || 0)}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('payments')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-red-100/50 flex items-center justify-center text-base sm:text-xl text-red-600"><DashboardIcon name="complaints" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Pending Amount</p>
              <p className="text-base sm:text-xl font-bold text-red-500 truncate">{formatCurrency(rentStatus.dueAmount || 0)}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('payments')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-slate-100/50 flex items-center justify-center text-base sm:text-xl text-slate-600"><DashboardIcon name="payments" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Deposit</p>
              <p className="text-base sm:text-xl font-bold text-gray-800 truncate">{formatCurrency(tenant?.security_deposit_amount || 0)}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('roommates')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-purple-100/50 flex items-center justify-center text-base sm:text-xl text-purple-600"><DashboardIcon name="users" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Roommates</p>
              <p className="text-base sm:text-xl font-bold text-gray-800">{roommates?.length || 0}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('notices')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-cyan-100/50 flex items-center justify-center text-xs sm:text-sm font-bold text-cyan-700"><DashboardIcon name="notices" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Notices</p>
              <p className="text-base sm:text-xl font-bold text-gray-800">{notices?.length || 0}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('complaints')} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-rose-100/50 flex items-center justify-center text-xs sm:text-sm font-bold text-rose-700"><DashboardIcon name="complaints" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Complaints</p>
              <p className="text-base sm:text-xl font-bold text-gray-800">{complaints?.length || 0}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('room-change')} disabled={isSubmitting} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:cursor-not-allowed disabled:opacity-70">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-blue-100/50 flex items-center justify-center text-xs sm:text-sm font-bold text-blue-700"><DashboardIcon name="requests" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Room Change</p>
              <p className="text-base sm:text-xl font-bold text-gray-800">{pendingRoomChangeRequest ? 'Pending' : 'Request'}</p>
            </div>
          </button>
          <button type="button" onClick={() => openSection('vacate')} disabled={isSubmitting} className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 hover:shadow-md hover:border-orange-200 transition flex items-center gap-2 sm:gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 disabled:cursor-not-allowed disabled:opacity-70">
            <div className="w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full bg-yellow-100/50 flex items-center justify-center text-xs sm:text-sm font-bold text-yellow-700"><DashboardIcon name="home" className="h-4 w-4 sm:h-5 sm:w-5" /></div>
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">Vacate</p>
              <p className="text-base sm:text-xl font-bold text-gray-800 capitalize">{existingVacateRequest ? existingVacateRequest.status : 'Request'}</p>
            </div>
          </button>
        </div></section>}

        {/* --- ACTION BUTTONS (GRADIENT & GLASS) --- */}
        {activeTab === 'overview' && <section aria-labelledby="tenant-actions-title" className="mb-6 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:mb-8 lg:block"><div className="mb-3"><h2 id="tenant-actions-title" className="font-bold text-slate-900">Quick actions</h2><p className="text-sm text-slate-500">Pay rent or send a request to your property team.</p></div><div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
          <button onPointerEnter={() => PayRentModal.preload?.()} onFocus={() => PayRentModal.preload?.()} onClick={openPaymentModal} disabled={isSubmitting || !canPayRent} className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-6 py-2.5 rounded-full text-sm font-semibold shadow-md transition disabled:cursor-not-allowed disabled:opacity-50">{canPayRent ? 'Pay Rent (UPI)' : paymentActionLabel}</button>
          <button onPointerEnter={() => ComplaintModal.preload?.()} onFocus={() => ComplaintModal.preload?.()} onClick={() => setShowComplaintModal(true)} disabled={isSubmitting} className="w-full sm:w-auto border-2 border-orange-300/50 text-orange-700 bg-white/50 backdrop-blur-sm px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-orange-50 transition disabled:opacity-50">Raise Complaint</button>
          {!pendingRoomChangeRequest ? (
            <button onPointerEnter={() => RoomChangeModal.preload?.()} onFocus={() => RoomChangeModal.preload?.()} onClick={openRoomChangeModal} disabled={isSubmitting} className="w-full sm:w-auto border-2 border-blue-300/50 text-blue-700 bg-white/50 backdrop-blur-sm px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-blue-50 transition disabled:opacity-50">Request Room Change</button>
          ) : (
            <button disabled className="w-full sm:w-auto border-2 border-gray-300/50 text-gray-500 bg-white/50 backdrop-blur-sm px-6 py-2.5 rounded-full text-sm font-semibold cursor-not-allowed">Room Change Pending</button>
          )}
          {existingVacateRequest ? (
            <button onClick={cancelVacateRequest} disabled={isSubmitting || Boolean(cancelVacateBlockedReason)} className="w-full sm:w-auto border-2 border-yellow-500/50 text-yellow-700 bg-white/50 backdrop-blur-sm px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-yellow-50 transition disabled:cursor-not-allowed disabled:opacity-50">{cancelVacateBlockedReason ? 'Cancellation unavailable' : (existingVacateRequest.status === 'approved' ? 'Vacate Approved / Cancel' : 'Vacate Request Pending / Cancel')}</button>
          ) : (
            <button onPointerEnter={() => VacateModal.preload?.()} onFocus={() => VacateModal.preload?.()} onClick={() => setShowVacateModal(true)} disabled={isSubmitting || Boolean(vacateBlockedReason)} title={vacateBlockedReason || undefined} className="w-full sm:w-auto border-2 border-red-300/50 text-red-700 bg-white/50 backdrop-blur-sm px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed">Request Vacate</button>
          )}
        </div></section>}
        {activeTab === 'overview' && vacateBlockedReason && (
          <p className="-mt-4 mb-6 text-sm font-medium text-red-600" role="status">{vacateBlockedReason}</p>
        )}

        {/* --- TABS (ONYX & GOLD) --- */}
        <div className="hidden"><DashboardSectionNav label="Tenant dashboard sections" activeId={activeTab} onSelect={openSection} items={[
          { id: 'overview', label: 'Overview' }, { id: 'roommates', label: `Roommates (${roommates?.length || 0})` },
          { id: 'notices', label: `Notices (${notices?.length || 0})` }, { id: 'complaints', label: `Complaints (${complaints?.length || 0})` },
          { id: 'payments', label: `Payments (${paymentHistory?.length || 0})` },
        ]} /></div>

        {/* --- TAB CONTENT --- */}
        <div ref={sectionRef} className="scroll-mt-28">
          {renderMountedTenantDesktopTabs()}
        </div>
      </main>



      {/* --- MODALS (LAZY LOADED) --- */}
      <AnimatePresence>
        {showPaymentModal && canPayRent && (
          <PayRentModal
            tenant={tenantWithRentSummary}
            room={room}
            ownerUpiId={ownerUpiId}
            ownerUpiPhone={ownerUpiPhone}
            paymentTransactionId={paymentTransactionId}
            setPaymentTransactionId={setPaymentTransactionId}
            paymentScreenshot={paymentScreenshot}
            setPaymentScreenshot={setPaymentScreenshot}
            paymentLoading={paymentLoading}
            isSubmitting={isSubmitting}
            copyUpiId={copyUpiId}
            copyUpiPhone={copyUpiPhone}
            submitPaymentWithProof={submitRentPaymentProof}
            onCancel={() => setShowPaymentModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showComplaintModal && (
          <ComplaintModal
            complaintForm={complaintForm}
            setComplaintForm={setComplaintForm}
            isSubmitting={isSubmitting}
            onSubmit={submitComplaint}
            onCancel={() => setShowComplaintModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVacateModal && (
          <VacateModal
            vacateForm={vacateForm}
            setVacateForm={setVacateForm}
            ratingHover={ratingHover}
            setRatingHover={setRatingHover}
            isSubmitting={isSubmitting}
            tenant={tenant}
            onSubmit={requestVacate}
            onCancel={() => setShowVacateModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfileModal && (
          <ProfileModal
            tenant={tenantWithRentSummary}
            room={room}
            profilePhotoUrl={profilePhotoUrl}
            rentStatus={rentStatus}
            profileForm={profileForm}
            setProfileForm={setProfileForm}
            profilePhotoPreview={profilePhotoPreview}
            onProfilePhotoChange={handleProfilePhotoChange}
            editProfile={editProfile}
            setEditProfile={setEditProfile}
            isSubmitting={isSubmitting}
            onUpdate={updateProfile}
            onCancel={() => { if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview); setShowProfileModal(false); setProfilePhotoPreview('') }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRoomChangeModal && (
          <RoomChangeModal
            availableRooms={availableRooms}
            selectedNewRoom={selectedNewRoom}
            setSelectedNewRoom={setSelectedNewRoom}
            roomChangeReason={roomChangeReason}
            setRoomChangeReason={setRoomChangeReason}
            isSubmitting={isSubmitting || roomChangeSubmitting}
            onSubmit={submitRoomChangeRequest}
            onCancel={() => setShowRoomChangeModal(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScreenshotModal && screenshotUrl && (
          <ScreenshotModal
            url={screenshotUrl}
            onClose={() => setShowScreenshotModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------- THE EXPORT WITH PROVIDER WRAPPER ----------------
export default function TenantDashboard() {
  return (
    <TenantProvider>
      <TenantDashboardContent />
    </TenantProvider>
  )
}
