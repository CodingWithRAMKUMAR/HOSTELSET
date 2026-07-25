import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { signOut, signPrivateDocumentFields } from '../../lib/supabase';
import { formatCurrency } from '../../lib/utils';
import { AdminProvider, useAdmin } from '../../context/AdminContext';
import BrandLogo from '../../components/BrandLogo';
import NotificationBell from '../../components/common/NotificationBell';
import ThemeToggle from '../../components/common/ThemeToggle';
import { useAdminProperties } from '../../hooks/useAdminProperties';
import { useAdminTenants } from '../../hooks/useAdminTenants';
import { useAdminOwners } from '../../hooks/useAdminOwners';
import { useAdminUsers } from '../../hooks/useAdminUsers';
import { useAdminPayments } from '../../hooks/useAdminPayments';
import { useAdminPreBookings } from '../../hooks/useAdminPreBookings';
import { useAdminApplications } from '../../hooks/useAdminApplications';
import { useAdminApprovedApplications } from '../../hooks/useAdminApprovedApplications';
import { useAdminComplaints } from '../../hooks/useAdminComplaints';
import { useAdminVacate } from '../../hooks/useAdminVacate';
import { useAdminRoomChange } from '../../hooks/useAdminRoomChange';
import { useAdminNotices } from '../../hooks/useAdminNotices';
import { useAdminMembershipManager } from '../../hooks/useAdminMembershipManager';
import { useAdminModals } from '../../hooks/useAdminModals';
import { useAdminAnalytics } from '../../hooks/useAdminAnalytics';
import { useAdminOverviewSnapshot } from '../../hooks/useAdminOverviewSnapshot';
import { Skeleton, TableSkeletonRows } from '../../components/ui/Skeleton';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import AdminGlobalSearch from '../../components/admin/AdminGlobalSearch';
import { displayBloodGroup } from '../../lib/bloodGroups';
import DashboardSectionNav from '../../components/dashboard/DashboardSectionNav';
import DashboardSidebar from '../../components/dashboard/DashboardSidebar';
import DashboardIcon from '../../components/dashboard/DashboardIcon';
import MobileTopbar from '../../components/dashboard/MobileTopbar';
import MobileBottomNav from '../../components/dashboard/MobileBottomNav';
import DashboardMoreMenu from '../../components/dashboard/DashboardMoreMenu';
import AccountMenu from '../../components/dashboard/AccountMenu';
import { resetDashboardScroll } from '../../lib/dashboardScroll';
import { dashboardPanelProps, prepareDashboardTabFocus } from '../../lib/dashboardFocus';
import { buildDashboardHref, isCanonicalDashboardQuery, pushDashboardHistory, replaceDashboardHistory, resolveDashboardQuery } from '../../lib/dashboardRouting';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import AdminMobileDashboard from '../../components/admin/mobile/AdminMobileDashboard';
import AdminMobileSearch from '../../components/admin/mobile/AdminMobileSearch';
import AdminMobileProperties from '../../components/admin/mobile/AdminMobileProperties';
import AdminMobileOwners from '../../components/admin/mobile/AdminMobileOwners';
import AdminMobileUsers from '../../components/admin/mobile/AdminMobileUsers';
import AdminMobilePayments from '../../components/admin/mobile/AdminMobilePayments';
import AdminMobileMore from '../../components/admin/mobile/AdminMobileMore';
import { AdminEmptyState, AdminLoadingState, AdminMobilePage, AdminStatusChip } from '../../components/admin/mobile/AdminMobileShell';
const MembershipManager = dynamic(() => import('../../components/admin/MembershipManager'));
const EnterpriseAdminConsole = dynamic(() => import('../../components/admin/EnterpriseAdminConsole'), { ssr: false });
const AdminAnalytics = dynamic(() => import('../../components/analytics/AdminAnalytics'));

const ADMIN_VIEW_KEYS = new Set(['overview', 'enterprise', 'analytics', 'global-search', 'properties', 'tenants', 'owners', 'users', 'payments', 'prebookings', 'applications', 'approvedapps', 'complaints', 'vacate', 'roomchange', 'notices', 'membership'])
const ADMIN_PERSISTENT_TABS = ['overview', 'enterprise', 'membership', 'properties', 'owners', 'tenants', 'payments', 'applications', 'complaints', 'vacate', 'roomchange', 'notices', 'analytics', 'global-search', 'users', 'prebookings', 'approvedapps']
const ADMIN_OVERVIEW_QUEUE_TABS = new Set()
const ADMIN_VIEW_ALIASES = {
  search: 'global-search',
  'room-change': 'roomchange',
  roomChange: 'roomchange',
  applicationsApproved: 'approvedapps',
  imports: 'enterprise',
}

function markAdminViewPerf(label, detail = '') {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetAdminPerf') !== '1' || typeof performance === 'undefined') return
  console.info(`[AdminView] ${label}${detail ? ` ${detail}` : ''}`)
}

function AdminTabPanel({ tab, active, children }) {
  useEffect(() => {
    if (active) markAdminViewPerf('visible-commit', tab)
  }, [active, tab])

  return (
    <section {...dashboardPanelProps('admin', tab, active)} data-admin-tab={tab}>
      {children}
    </section>
  )
}

// ----------------- UTILITY TABLE COMPONENT -----------------
const AdminTable = ({ headers, data, renderRow, renderCard, emptyMessage, loading = false }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
    {renderCard && (
      <div className="space-y-2 p-2 md:hidden">
        {loading && data.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Loading...</div>
        ) : data.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">{emptyMessage}</div>
        ) : data.map(item => renderCard(item))}
      </div>
    )}
    <div className={`${renderCard ? 'hidden md:block' : ''} overflow-x-auto`}>
      <table className="w-full text-sm text-left">
        <thead className="bg-[#1a1a1a] text-white/90 border-b border-orange-500/30">
          <tr>{headers.map((h, i) => <th key={i} className="px-6 py-4 whitespace-nowrap font-medium tracking-wide">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading && data.length === 0 ? (
            <TableSkeletonRows columns={headers.length} />
          ) : data.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-6 py-12 text-center text-gray-400 italic">{emptyMessage}</td></tr>
          ) : (
            data.map((item, index) => renderRow(item, index))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

const displayDateTime = value => {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function AdminActionCenter({ cards, membershipRequests, applications, complaints, vacateRequests, roomChanges, notices, noticeCount, paymentIssueCount, onOpen, onReviewMembership, processingId }) {
  const primaryMembership = membershipRequests[0]
  const recentQueues = [
    ...membershipRequests.slice(0, 2).map(item => ({
      id: `membership:${item.id}`,
      tab: 'membership',
      recordKey: 'membership_id',
      recordId: item.id,
      title: item.owner?.full_name || 'Unknown owner',
      meta: item.property?.name || 'No property linked',
      date: item.requested_at,
      badge: item.plan_id === 'yearly' ? 'Yearly' : 'Monthly',
      tone: 'amber',
    })),
    ...applications.slice(0, 2).map(item => ({
      id: `application:${item.id}`,
      tab: 'applications',
      recordKey: 'application_id',
      recordId: item.id,
      title: item.name || 'Tenant application',
      meta: `Room ${item.rooms?.room_number || 'N/A'}`,
      date: item.created_at,
      badge: (item.payment_status || 'pending').replaceAll('_', ' '),
      tone: 'blue',
    })),
    ...complaints.slice(0, 2).map(item => ({
      id: `complaint:${item.id}`,
      tab: 'complaints',
      recordKey: 'complaint_id',
      recordId: item.id,
      title: item.title || 'Complaint',
      meta: item.tenants?.name || 'Tenant',
      date: item.created_at,
      badge: item.status,
      tone: item.status === 'open' ? 'red' : 'amber',
    })),
    ...vacateRequests.slice(0, 1).map(item => ({
      id: `vacate:${item.id}`,
      tab: 'vacate',
      recordKey: 'request_id',
      recordId: item.id,
      title: item.tenants?.name || item.tenant_name || 'Vacate request',
      meta: item.expected_check_out ? `Checkout ${displayDateTime(item.expected_check_out)}` : 'Pending checkout',
      date: item.created_at,
      badge: item.status,
      tone: 'amber',
    })),
    ...roomChanges.slice(0, 1).map(item => ({
      id: `roomchange:${item.id}`,
      tab: 'roomchange',
      recordKey: 'request_id',
      recordId: item.id,
      title: item.tenants?.name || 'Room change',
      meta: `${item.old_room?.room_number || 'Old room'} to ${item.new_room?.room_number || 'new room'}`,
      date: item.requested_at,
      badge: item.status || 'pending',
      tone: 'violet',
    })),
  ].slice(0, 6)

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="admin-action-center-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="admin-action-center-title" className="text-base font-black text-slate-900 sm:text-lg">Action Center</h2>
          <p className="text-xs text-slate-500 sm:text-sm">Pending platform requests that need admin attention.</p>
        </div>
        <button type="button" onClick={() => onOpen('membership')} className="min-h-[2.5rem] rounded-xl bg-slate-900 px-3 text-xs font-bold text-white">Review memberships</button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map(card => (
          <button key={card.id} type="button" onClick={() => onOpen(card.tab)} className="min-h-[4.4rem] min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 text-left transition hover:border-orange-200 hover:bg-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 truncate text-xl font-black text-slate-900">{card.value}</p>
          </button>
        ))}
      </div>

      {primaryMembership && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => onOpen('membership', { membership_id: primaryMembership.id })} className="min-w-0 text-left">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Oldest membership request</p>
              <p className="truncate text-sm font-black text-slate-900">{primaryMembership.owner?.full_name || 'Unknown owner'} · {primaryMembership.property?.name || 'No property linked'}</p>
              <p className="truncate text-xs text-slate-600">{primaryMembership.plan_id === 'yearly' ? 'Yearly' : 'Monthly'} plan · {displayDateTime(primaryMembership.requested_at)}</p>
            </button>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button type="button" disabled={Boolean(processingId)} onClick={() => onReviewMembership(primaryMembership.id, true)} className="min-h-[2.5rem] rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50">Approve</button>
              <button type="button" disabled={Boolean(processingId)} onClick={() => onReviewMembership(primaryMembership.id, false)} className="min-h-[2.5rem] rounded-lg bg-red-600 px-3 text-xs font-bold text-white disabled:opacity-50">Reject</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
        <div className="space-y-2">
          {recentQueues.length ? recentQueues.map(item => (
            <button key={item.id} type="button" onClick={() => onOpen(item.tab, { [item.recordKey]: item.recordId })} className="flex min-h-[3.25rem] w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-orange-200 hover:bg-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{item.title}</p>
                <p className="truncate text-xs text-slate-500">{item.meta} · {displayDateTime(item.date)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${item.tone === 'red' ? 'bg-red-100 text-red-700' : item.tone === 'blue' ? 'bg-blue-100 text-blue-700' : item.tone === 'violet' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>{item.badge}</span>
            </button>
          )) : <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">No pending queues are waiting right now.</div>}
        </div>
        <div className="grid gap-2">
          <button type="button" onClick={() => onOpen('payments')} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Payment issues</p>
            <p className="mt-1 text-lg font-black text-slate-900">{paymentIssueCount}</p>
          </button>
          <button type="button" onClick={() => onOpen('notices')} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Recent notices</p>
            <p className="mt-1 text-lg font-black text-slate-900">{noticeCount}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{notices[0]?.title || 'No global notices posted'}</p>
          </button>
        </div>
      </div>
    </section>
  )
}

function AdminNoticeComposer({ onPost, compact = false }) {
  const [form, setForm] = useState({ title: '', content: '', type: 'general', is_urgent: false })
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview('')
    setImageFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const selectImage = event => {
    const file = event.target.files?.[0] || null
    if (!file) {
      clearImage()
      return
    }
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Choose a JPEG, PNG, WEBP, or GIF image.')
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Notice image must be smaller than 5 MB.')
      event.target.value = ''
      return
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const submitNotice = async event => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const posted = await onPost(
        form.title.trim(),
        form.content.trim(),
        form.type,
        form.is_urgent,
        imageFile,
      )
      if (!posted) return
      setForm({ title: '', content: '', type: 'general', is_urgent: false })
      clearImage()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submitNotice} className={`rounded-2xl border border-slate-200 bg-white ${compact ? 'p-3' : 'p-4 sm:p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900">Post global notice</h3>
          <p className="mt-1 text-xs text-slate-500">Visible to every HostelSet owner and tenant.</p>
        </div>
        {form.is_urgent && <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-black text-red-700">URGENT</span>}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs font-bold text-slate-700">
          Title
          <input required maxLength={160} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Notice title" className="min-h-[2.75rem] rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-700">
          Type
          <select value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value }))} className="min-h-[2.75rem] rounded-xl border border-slate-300 px-3 text-sm font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100">
            <option value="general">General</option>
            <option value="urgent">Urgent</option>
            <option value="maintenance">Maintenance</option>
            <option value="payment">Payment</option>
            <option value="event">Event</option>
            <option value="emergency">Emergency</option>
          </select>
        </label>
      </div>

      <label className="mt-3 grid gap-1 text-xs font-bold text-slate-700">
        Message
        <textarea required maxLength={5000} rows={compact ? 3 : 4} value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} placeholder="Write the announcement" className="resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1 text-xs font-bold text-slate-700">
          Image (optional)
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectImage} className="block w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-normal file:mr-3 file:rounded-lg file:border-0 file:bg-orange-100 file:px-3 file:py-1.5 file:font-bold file:text-orange-700" />
          <span className="font-normal text-slate-400">JPEG, PNG, WEBP, or GIF. Maximum 5 MB.</span>
        </label>
        <label className="flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={form.is_urgent} onChange={event => setForm(current => ({ ...current, is_urgent: event.target.checked }))} className="rounded border-slate-300 text-orange-500 focus:ring-orange-500" />
          Mark urgent
        </label>
      </div>

      {imagePreview && (
        <div className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <img src={imagePreview} alt="Selected notice preview" className={`${compact ? 'max-h-40' : 'max-h-56'} w-full object-contain`} />
          <button type="button" onClick={clearImage} className="absolute right-2 top-2 rounded-full bg-slate-950/80 px-3 py-1 text-xs font-bold text-white">Remove image</button>
        </div>
      )}

      <button type="submit" disabled={submitting} className="mt-4 min-h-[2.75rem] w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 text-sm font-black text-white shadow-sm transition hover:from-orange-600 hover:to-amber-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
        {submitting ? (imageFile ? 'Uploading and posting…' : 'Posting…') : 'Post global notice'}
      </button>
    </form>
  )
}

// ----------------- DETAIL MODAL COMPONENT -----------------
const detailValue = value => {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'object') return '—'
  return String(value).replace(/<[^>]*>/g, '')
}

const dateValue = value => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const DetailField = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-slate-900">{detailValue(value)}</p>
  </div>
)

const BadgeList = ({ label, values }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {Array.isArray(values) && values.length ? values.map(item => (
        <span key={String(item)} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{detailValue(item)}</span>
      )) : <span className="text-sm font-semibold text-slate-900">—</span>}
    </div>
  </div>
)

const knownDetailFields = (title, data) => {
  const lower = String(title || '').toLowerCase()
  if (lower.includes('property')) {
    return {
      fields: [
        ['Name', data.name],
        ['Owner', data.owner_name || data.owner?.full_name || data.owner_id],
        ['Address', data.formatted_address || data.address],
        ['City', data.city],
        ['Contact', data.phone || data.contact || data.owner_phone],
        ['Rooms', data.total_rooms || data.rooms_count],
        ['Capacity', data.capacity || data.total_capacity],
        ['Occupancy', data.occupied || data.current_occupants],
        ['Rent', data.monthly_rent ? formatCurrency(data.monthly_rent) : data.rent_range],
        ['Deposit', data.security_deposit ? formatCurrency(data.security_deposit) : data.deposit],
        ['Status', data.is_active === false ? 'Inactive' : data.status || 'Active'],
        ['Created', dateValue(data.created_at)],
      ],
      badges: [['Amenities', data.amenities]],
    }
  }
  if (lower.includes('tenant') || data.role === 'tenant') {
    return {
      fields: [
        ['Name', data.name || data.full_name],
        ['Email', data.email],
        ['Phone', data.phone],
        ['Blood group', displayBloodGroup(data.blood_group)],
        ['Property', data.property_name || data.property?.name || data.property_id],
        ['Room', data.room_number || data.rooms?.room_number || data.room_id],
        ['Rent', data.rent_amount ? formatCurrency(data.rent_amount) : null],
        ['Deposit', data.security_deposit ? formatCurrency(data.security_deposit) : null],
        ['Join date', dateValue(data.move_in_date || data.join_date || data.created_at)],
        ['Status', data.status || (data.is_active === false ? 'Inactive' : 'Active')],
        ['Emergency contact', data.emergency_contact || data.emergency_phone],
        ['Payment summary', data.pending_amount ? `Pending ${formatCurrency(data.pending_amount)}` : data.rent_status],
      ],
      badges: [],
    }
  }
  return {
    fields: Object.entries(data)
      .filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 16)
      .map(([key, value]) => [key.replace(/_/g, ' '), key.includes('date') || key.endsWith('_at') ? dateValue(value) : value]),
    badges: [],
  }
}

const DetailModal = ({ isOpen, onClose, title, data }) => {
  const dialogRef = useModalAccessibility(onClose, false, isOpen);
  if (!isOpen || !data) return null;
  const details = knownDetailFields(title, data);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="admin-detail-title" className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden shadow-2xl border border-orange-500/20 outline-none" onClick={event => event.stopPropagation()}>
        <div className="bg-[#1a1a1a] p-5 flex justify-between items-center border-b border-orange-500/30">
          <h3 id="admin-detail-title" className="text-white text-lg font-bold tracking-wide">{title}</h3>
          <button onClick={onClose} aria-label="Close details" className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {details.fields.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}
            {details.badges.map(([label, values]) => <BadgeList key={label} label={label} values={values} />)}
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="bg-gray-200 hover:bg-gray-300 px-6 py-2 rounded-lg font-medium transition">Close</button>
        </div>
      </div>
    </div>
  );
};

// ----------------- MAIN DASHBOARD CONTENT -----------------
function AdminDashboardContent() {
  const router = useRouter();
  const { globalStats, statsLoading, realtimeConnected, refreshStats } = useAdmin();
  const [activeTab, setActiveTab] = useState('overview');
  const [mountedTabs, setMountedTabs] = useState(() => new Set(['overview']));
  const [mobileMenu, setMobileMenu] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const sectionRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const openSection = (tab, focusQuery = {}) => {
    markAdminViewPerf('tab-click', String(tab));
    const nextTab = ADMIN_VIEW_ALIASES[tab] || tab;
    if (!ADMIN_VIEW_KEYS.has(nextTab)) {
      if (process.env.NODE_ENV !== 'production') console.warn('[HostelSet] Unknown admin dashboard view key:', tab);
      replaceDashboardHistory(router, buildDashboardHref('admin', 'overview', router.query));
      setActiveTab('overview');
      setMobileMenu(null); setProfileMenuOpen(false); resetDashboardScroll();
      return;
    }
    if (!router.isReady || nextTab === activeTab) {
      setMobileMenu(null); setProfileMenuOpen(false);
      return;
    }
    const href = buildDashboardHref('admin', nextTab, { ...router.query, ...focusQuery });
    markAdminViewPerf('set-activeTab', nextTab);
    prepareDashboardTabFocus('admin', activeTabRef.current, nextTab);
    setActiveTab(nextTab);
    setMobileMenu(null); setProfileMenuOpen(false); closeAdminOverlaysForNavigation(); resetDashboardScroll();
    window.requestAnimationFrame?.(() => pushDashboardHistory(router, href)) || pushDashboardHistory(router, href);
  };
  const navigateDashboardBack = () => {
    setMobileMenu(null); setProfileMenuOpen(false);
    if (activeTab !== 'overview') {
      replaceDashboardHistory(router, buildDashboardHref('admin', 'overview', router.query));
      prepareDashboardTabFocus('admin', activeTabRef.current, 'overview');
      setActiveTab('overview');
      resetDashboardScroll();
      return;
    }
    router.back();
  };
  
  const isAdminSectionEnabled = tab => mountedTabs.has(tab) || activeTab === tab || ADMIN_OVERVIEW_QUEUE_TABS.has(tab);
  const { properties, loading: propertiesLoading, archiveProperty, restoreProperty } = useAdminProperties(isAdminSectionEnabled('properties'));
  const { tenants, loading: tenantsLoading, error: tenantsError, deleteTenant } = useAdminTenants(isAdminSectionEnabled('tenants'));
  const { owners, loading: ownersLoading, toggleOwnerStatus } = useAdminOwners(isAdminSectionEnabled('owners'));
  const { users, loading: usersLoading, searchTerm, setSearchTerm, roleFilter, setRoleFilter, toggleUserStatus, changeUserRole } = useAdminUsers(isAdminSectionEnabled('users'));
  const { payments, loading: paymentsLoading, confirmPayment, rejectPayment } = useAdminPayments(isAdminSectionEnabled('payments'));
  const { preBookings, loading: preBookingsLoading, approvePreBooking, rejectPreBooking } = useAdminPreBookings(isAdminSectionEnabled('prebookings'));
  const { applications, loading: applicationsLoading, approveApplication, rejectApplication } = useAdminApplications(isAdminSectionEnabled('applications'));
  const { approvedApps, loading: approvedAppsLoading } = useAdminApprovedApplications(isAdminSectionEnabled('approvedapps'));
  const { complaints, loading: complaintsLoading, resolveComplaint, deleteComplaint } = useAdminComplaints(isAdminSectionEnabled('complaints'));
  const { vacateRequests, loading: vacateLoading, approveVacate, rejectVacate } = useAdminVacate(isAdminSectionEnabled('vacate'));
  const { roomChanges, loading: roomChangesLoading, approveRoomChange, rejectRoomChange } = useAdminRoomChange(isAdminSectionEnabled('roomchange'));
  const { notices, loading: noticesLoading, postNotice, deleteNotice } = useAdminNotices(isAdminSectionEnabled('notices'));
  const { owners: membershipOwners, requests: membershipRequests, loading: membershipLoading, processingId: membershipProcessingId, getDaysLeft, sendRenewalEmail, grantMembership, revokeMembership, reviewRequest, refresh: refreshMemberships } = useAdminMembershipManager(isAdminSectionEnabled('membership'));
  const { selectedProperty, selectedOwner, viewPropertyDetails, viewOwnerDetails, closeModals } = useAdminModals();
  const adminAnalytics = useAdminAnalytics(isAdminSectionEnabled('analytics'));
  const { snapshot: overviewSnapshot, refreshSnapshot: refreshAdminOverview } = useAdminOverviewSnapshot(activeTab === 'overview');
  const refreshAdminStats = () => Promise.all([
    refreshStats({ background: true, force: true, reason: 'manual-refresh' }),
    refreshAdminOverview({ background: true, force: true, reason: 'manual-refresh' }),
  ]);

  const [searchDetail, setSearchDetail] = useState(null);
  const [applicationProof, setApplicationProof] = useState(null);
  function closeAdminOverlaysForNavigation() {
    setProfileMenuOpen(false)
    setMobileMenu(null)
    setSearchDetail(null)
    setApplicationProof(null)
    closeModals()
  }
  const hasOpenOverlay = profileMenuOpen || mobileMenu === 'more' || Boolean(searchDetail) || Boolean(applicationProof) || Boolean(selectedProperty) || Boolean(selectedOwner);
  useBodyScrollLock(hasOpenOverlay);

  useEffect(() => {
    if (!router.isReady) return
    const resolved = resolveDashboardQuery('admin', router.query)
    if (!isCanonicalDashboardQuery('admin', router.query)) {
      replaceDashboardHistory(router, buildDashboardHref('admin', resolved.view, router.query))
      prepareDashboardTabFocus('admin', activeTabRef.current, resolved.view)
      setActiveTab(resolved.view)
      setMobileMenu(null)
      resetDashboardScroll()
      return
    }
    if (activeTabRef.current !== resolved.view) {
      resetDashboardScroll()
      prepareDashboardTabFocus('admin', activeTabRef.current, resolved.view)
    }
    setActiveTab(resolved.view)
    setMobileMenu(null)
  }, [router.isReady, router.query.tab, router.query.property_id, router.query.membership_id, router.query.payment_id, router.query.application_id, router.query.complaint_id, router.query.request_id])

  useEffect(() => {
    if (!ADMIN_VIEW_KEYS.has(activeTab)) return
    setMountedTabs(previous => {
      if (previous.has(activeTab)) return previous
      const next = new Set(previous)
      next.add(activeTab)
      return next
    })
  }, [activeTab])
  const [actionKey, setActionKey] = useState(null);

  const runAdminAction = async (key, action) => {
    if (actionKey) return;
    setActionKey(key);
    try { await action(); }
    finally { setActionKey(null); }
  };

  const openSignedApplicationProof = async (application) => {
    const loadingToast = toast.loading('Opening document…')
    try {
      const signed = await signPrivateDocumentFields({ ...application, source_type: 'application' }, ['payment_screenshot'])
      const url = signed?.payment_screenshot || null
      if (!url) {
        setApplicationProof(null)
        toast.error('This document is unavailable or has been removed.')
        return
      }
      setApplicationProof({ url, name: application.name })
    } catch {
      setApplicationProof(null)
      toast.error('This document is unavailable or has been removed.')
    } finally {
      toast.dismiss(loadingToast)
    }
  };

  const openSignedPaymentProof = async (payment) => {
    const loadingToast = toast.loading('Opening document…')
    try {
      const signed = await signPrivateDocumentFields(payment, ['payment_screenshot'])
      const url = signed?.payment_screenshot || null
      if (!url) {
        setApplicationProof(null)
        toast.error('This document is unavailable or has been removed.')
        return
      }
      setApplicationProof({ url, name: payment.tenants?.name || 'Payment' })
    } catch {
      setApplicationProof(null)
      toast.error('This document is unavailable or has been removed.')
    } finally {
      toast.dismiss(loadingToast)
    }
  };

  const handleLogout = async () => {
    await signOut();
    window.location.replace('/login');
  };

  // STATS CARDS
  const statsData = [
    { label: 'Properties', value: statsLoading ? '-' : globalStats.totalProperties, icon: 'home', color: 'bg-orange-100 text-orange-600' },
    { label: 'Active Tenants', value: statsLoading ? '-' : globalStats.totalTenants, icon: 'users', color: 'bg-blue-100 text-blue-600' },
    { label: 'Owners', value: statsLoading ? '-' : globalStats.totalOwners, icon: 'users', color: 'bg-violet-100 text-violet-600' },
    { label: 'Active Owners', value: statsLoading ? '-' : globalStats.activeOwners, icon: 'users', color: 'bg-green-100 text-green-600' },
    { label: 'Memberships', value: statsLoading ? '-' : globalStats.activeMemberships, icon: 'calendar', color: 'bg-amber-100 text-amber-600' },
    { label: 'Rent Revenue', value: statsLoading ? '-' : formatCurrency(globalStats.totalRevenue), icon: 'payments', color: 'bg-emerald-100 text-emerald-600' },
    { label: 'Deposits', value: statsLoading ? '-' : formatCurrency(globalStats.totalDeposits), icon: 'payments', color: 'bg-slate-100 text-slate-600' },
    { label: 'Pending Complaints', value: statsLoading ? '-' : globalStats.pendingComplaints, icon: 'complaints', color: 'bg-red-100 text-red-600' },
    { label: 'Pending Vacates', value: statsLoading ? '-' : globalStats.pendingVacates, icon: 'home', color: 'bg-amber-100 text-amber-600' },
  ];
  const pendingMembershipRequests = overviewSnapshot.membershipRequests;
  const pendingApplications = overviewSnapshot.applications;
  const openComplaints = overviewSnapshot.complaints;
  const pendingVacateRequests = overviewSnapshot.vacateRequests;
  const pendingRoomChanges = overviewSnapshot.roomChanges;
  const overviewNotices = overviewSnapshot.notices;
  const overviewCounts = overviewSnapshot.counts;
  const reservationCountsByRoom = useMemo(() => preBookings.reduce((counts, booking) => {
    if (booking.status === 'reserved') counts[booking.room_id] = (counts[booking.room_id] || 0) + 1;
    return counts;
  }, {}), [preBookings]);
  const actionCenterCards = useMemo(() => [
    { id: 'membership', label: 'Pending memberships', value: overviewCounts.pendingMemberships, tab: 'membership' },
    { id: 'applications', label: 'Pending applications', value: overviewCounts.pendingApplications, tab: 'applications' },
    { id: 'complaints', label: 'Open complaints', value: overviewCounts.openComplaints, tab: 'complaints' },
    { id: 'vacate', label: 'Pending vacates', value: overviewCounts.pendingVacates, tab: 'vacate' },
    { id: 'roomchange', label: 'Room changes', value: overviewCounts.pendingRoomChanges, tab: 'roomchange' },
    { id: 'payments', label: 'Payment issues', value: overviewCounts.paymentIssues, tab: 'payments' },
  ], [overviewCounts]);

  // TABS
  const tabs = [
    { id: 'analytics', label: 'Analytics' },
    { id: 'global-search', label: 'Global Search' },
    { id: 'overview', label: 'Overview' },
    { id: 'enterprise', label: 'Enterprise console' },
    { id: 'properties', label: 'Properties' },
    { id: 'tenants', label: 'Tenants' },
    { id: 'owners', label: 'Owners' },
    { id: 'users', label: 'Users' },
    { id: 'payments', label: 'Payments' },
    { id: 'prebookings', label: 'Pre-bookings' },
    { id: 'applications', label: 'Applications' },
    { id: 'approvedapps', label: 'Approved apps' },
    { id: 'complaints', label: 'Complaints' },
    { id: 'vacate', label: 'Vacate' },
    { id: 'roomchange', label: 'Room change' },
    { id: 'notices', label: 'Notices' },
    { id: 'membership', label: 'Membership' },
  ];

  const tabForStat = (label) => ({
    Properties: 'properties',
    'Active Tenants': 'tenants',
    Owners: 'owners',
    'Active Owners': 'owners',
    'Rent Revenue': 'payments',
    Deposits: 'payments',
    'Pending Complaints': 'complaints',
    'Pending Vacates': 'vacate',
  })[label];
  const adminSidebarItems = tabs.map(item => ({ ...item, icon: ({overview:'dashboard',analytics:'analytics',properties:'rooms',tenants:'users',owners:'users',users:'users',payments:'payments',complaints:'complaints',notices:'notices'})[item.id] || 'settings' }))
  const adminBottomItems = [{id:'overview',label:'Dashboard',icon:'dashboard'},{id:'search',label:'Search',icon:'search'},{id:'properties',label:'Properties',icon:'rooms'},{id:'tenants',label:'Tenants',icon:'users'},{id:'more',label:'More',icon:'more'}]
  const adminTitle = tabs.find(item=>item.id===activeTab)?.label || 'Dashboard'
  const adminMoreItems = [
    { id: 'overview', group: 'Platform', label: 'Dashboard', onClick: () => openSection('overview') },
    { id: 'properties', group: 'Platform', label: 'Properties', onClick: () => openSection('properties') },
    { id: 'owners', group: 'Platform', label: 'Owners', onClick: () => openSection('owners') },
    { id: 'tenants', group: 'Platform', label: 'Tenants', onClick: () => openSection('tenants') },
    { id: 'payments', group: 'Operations', label: 'Payments', onClick: () => openSection('payments') },
    { id: 'applications', group: 'Operations', label: 'Applications', onClick: () => openSection('applications') },
    { id: 'imports', group: 'Operations', label: 'Imports', onClick: () => openSection('imports') },
    { id: 'prebookings', group: 'Operations', label: 'Pre-bookings', onClick: () => openSection('prebookings') },
    { id: 'approvedapps', group: 'Operations', label: 'Approved apps', onClick: () => openSection('approvedapps') },
    { id: 'complaints', group: 'Operations', label: 'Complaints', onClick: () => openSection('complaints') },
    { id: 'vacate', group: 'Operations', label: 'Vacates', onClick: () => openSection('vacate') },
    { id: 'roomchange', group: 'Operations', label: 'Room changes', onClick: () => openSection('roomchange') },
    { id: 'analytics', group: 'Insights', label: 'Analytics', onClick: () => openSection('analytics') },
    { id: 'global-search', group: 'Insights', label: 'Global search', onClick: () => openSection('global-search') },
    { id: 'users', group: 'Insights', label: 'Users', onClick: () => openSection('users') },
    { id: 'notices', group: 'Account', label: 'Notices', onClick: () => openSection('notices') },
    { id: 'notifications', group: 'Account', label: 'Notifications', onClick: () => window.dispatchEvent(new Event('hostelset:open-notifications')) },
    { id: 'membership', group: 'Account', label: 'Membership', onClick: () => openSection('membership') },
    { id: 'logout', group: 'Account', label: 'Logout', danger: true, onClick: handleLogout },
  ]

  const renderMobileOperationList = ({ title, subtitle, loading, items, emptyMessage, renderItem }) => (
    <AdminMobilePage title={title} subtitle={subtitle} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)}>
      {loading && items.length === 0 ? <AdminLoadingState /> : null}
      {!loading && items.length === 0 ? <AdminEmptyState>{emptyMessage}</AdminEmptyState> : null}
      {items.map(renderItem)}
    </AdminMobilePage>
  )

  const renderAdminMobileTab = (tab = activeTab) => {
    if (tab === 'overview') {
      return <AdminMobileDashboard stats={statsData} actionCards={actionCenterCards} globalStats={globalStats} realtimeConnected={realtimeConnected} avatar="A" onProfile={() => setProfileMenuOpen(value => !value)} onNavigate={openSection} onRefresh={refreshAdminStats} />
    }
    if (tab === 'global-search') {
      return <AdminMobileSearch avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} onOpen={(group, item) => setSearchDetail({ group, item })} />
    }
    if (tab === 'enterprise') {
      return <AdminMobilePage title="Enterprise console" subtitle="Deep platform records" avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)}><EnterpriseAdminConsole /></AdminMobilePage>
    }
    if (tab === 'properties') {
      return <AdminMobileProperties properties={properties} loading={propertiesLoading} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} onView={viewPropertyDetails} onArchive={archiveProperty} onRestore={restoreProperty} />
    }
    if (tab === 'owners') {
      return <AdminMobileOwners owners={owners} loading={ownersLoading} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} onView={viewOwnerDetails} onToggle={toggleOwnerStatus} />
    }
    if (tab === 'users') {
      return <AdminMobileUsers title="Users" mode="users" users={users} loading={usersLoading} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} searchTerm={searchTerm} setSearchTerm={setSearchTerm} roleFilter={roleFilter} setRoleFilter={setRoleFilter} onToggleStatus={toggleUserStatus} onChangeRole={changeUserRole} />
    }
    if (tab === 'tenants') {
      return <AdminMobileUsers title="Tenants" mode="tenants" tenants={tenants} loading={tenantsLoading} error={tenantsError} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} onViewTenant={(tenant) => setSearchDetail({ group: 'Tenant', item: tenant })} onDeleteTenant={deleteTenant} />
    }
    if (tab === 'payments') {
      return <AdminMobilePayments payments={payments} loading={paymentsLoading} actionKey={actionKey} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)} onConfirm={(payment) => runAdminAction(`payment:${payment.id}`, () => confirmPayment(payment.id))} onReject={(payment) => runAdminAction(`payment:${payment.id}`, () => rejectPayment(payment.id))} onViewProof={openSignedPaymentProof} />
    }
    if (tab === 'prebookings') {
      return renderMobileOperationList({
        title: 'Pre-bookings',
        subtitle: `${preBookings.length} pre-bookings`,
        loading: preBookingsLoading,
        items: preBookings,
        emptyMessage: 'No pre-bookings found.',
        renderItem: booking => (
          <article key={booking.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{booking.name}</p><p className="truncate text-[11px] text-slate-500">Room {booking.rooms?.room_number || 'N/A'} / {booking.rooms?.properties?.name || 'N/A'}</p></div>
              <p className="shrink-0 text-xs font-black text-slate-700">{formatCurrency(booking.pre_booking_fee_amount || 0)}</p>
            </div>
            {booking.status === 'pending' ? <div className="mt-2 flex justify-end gap-2"><button disabled={Boolean(actionKey) || (Number(reservationCountsByRoom[booking.room_id] || 0) >= Number(booking.rooms?.capacity || 0))} onClick={() => runAdminAction(`prebooking:${booking.id}`, () => approvePreBooking(booking.id, booking.user_id, booking.room_id, booking.property_id, booking.name, booking.phone, booking.email, booking.rooms?.monthly_rent))} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">{Number(reservationCountsByRoom[booking.room_id] || 0) >= Number(booking.rooms?.capacity || 0) ? 'Capacity reached' : 'Reserve'}</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`prebooking:${booking.id}`, () => rejectPreBooking(booking.id))} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50">Reject</button></div> : <p className="mt-2 text-right text-xs font-bold text-purple-700">{booking.status === 'reserved' ? 'Reserved - waiting for vacancy' : 'Converted'}</p>}
          </article>
        ),
      })
    }
    if (tab === 'applications') {
      return renderMobileOperationList({
        title: 'Applications',
        subtitle: `${applications.length} pending applications`,
        loading: applicationsLoading,
        items: applications,
        emptyMessage: 'No pending applications.',
        renderItem: application => (
          <article key={application.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{application.name}</p><p className="truncate text-[11px] text-slate-500">Room {application.rooms?.room_number || 'N/A'} / {application.phone}</p></div>
              <AdminStatusChip tone="amber">{(application.payment_status || 'pending').replaceAll('_', ' ')}</AdminStatusChip>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs font-bold text-slate-700">{formatCurrency(application.payment_amount || 0)}</p><div className="flex shrink-0 gap-2">{application.payment_screenshot ? <button type="button" onClick={() => openSignedApplicationProof(application)} className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Proof</button> : null}<button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`application:${application.id}`, () => approveApplication(application, application.user_id))} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">Approve</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`application:${application.id}`, () => rejectApplication(application.id))} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50">Reject</button></div></div>
          </article>
        ),
      })
    }
    if (tab === 'approvedapps') {
      return renderMobileOperationList({
        title: 'Approved apps',
        subtitle: `${approvedApps.length} processed`,
        loading: approvedAppsLoading,
        items: approvedApps,
        emptyMessage: 'No processed applications yet.',
        renderItem: application => <article key={application.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{application.name}</p><p className="truncate text-[11px] text-slate-500">Room {application.rooms?.room_number || 'N/A'} / {application.processed_at ? new Date(application.processed_at).toLocaleDateString() : 'N/A'}</p></div><AdminStatusChip tone={application.status === 'approved' ? 'emerald' : 'red'}>{application.status}</AdminStatusChip></div></article>,
      })
    }
    if (tab === 'complaints') {
      return renderMobileOperationList({
        title: 'Complaints',
        subtitle: `${complaints.length} platform complaints`,
        loading: complaintsLoading,
        items: complaints,
        emptyMessage: 'No complaints in the system.',
        renderItem: complaint => <article key={complaint.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{complaint.title}</p><p className="truncate text-[11px] text-slate-500">{complaint.tenants?.name || 'N/A'}</p></div><AdminStatusChip tone={complaint.status === 'open' ? 'red' : complaint.status === 'in_progress' ? 'amber' : 'emerald'}>{complaint.status}</AdminStatusChip></div><div className="mt-2 flex justify-end gap-2"><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`complaint:${complaint.id}`, () => resolveComplaint(complaint.id))} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">Resolve</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`complaint:${complaint.id}`, () => deleteComplaint(complaint.id))} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50">Delete</button></div></article>,
      })
    }
    if (tab === 'vacate') {
      return renderMobileOperationList({
        title: 'Vacates',
        subtitle: `${vacateRequests.length} requests`,
        loading: vacateLoading,
        items: vacateRequests,
        emptyMessage: 'No vacate requests found.',
        renderItem: request => <article key={request.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{request.tenants?.name || 'N/A'}</p><p className="truncate text-[11px] text-slate-500">Room {request.tenants?.rooms?.room_number || 'N/A'} / {request.expected_check_out ? new Date(request.expected_check_out).toLocaleDateString() : 'N/A'}</p></div><AdminStatusChip tone={request.status === 'pending' ? 'amber' : 'emerald'}>{request.status}</AdminStatusChip></div>{request.status === 'pending' ? <div className="mt-2 flex justify-end gap-2"><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`vacate:${request.id}`, () => approveVacate(request.id, request.tenant_id, request.expected_check_out))} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">Approve</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`vacate:${request.id}`, () => rejectVacate(request.id))} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50">Reject</button></div> : null}</article>,
      })
    }
    if (tab === 'roomchange') {
      return renderMobileOperationList({
        title: 'Room changes',
        subtitle: `${roomChanges.length} requests`,
        loading: roomChangesLoading,
        items: roomChanges,
        emptyMessage: 'No room change requests found.',
        renderItem: request => <article key={request.id} className="rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{request.tenants?.name || 'N/A'}</p><p className="truncate text-[11px] text-slate-500">{request.old_room?.room_number || 'N/A'} to {request.new_room?.room_number || 'N/A'}</p></div><div className="mt-2 flex justify-end gap-2"><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`roomchange:${request.id}`, () => approveRoomChange(request.id, request.tenant_id, request.new_room_id, request.old_room_id))} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 disabled:opacity-50">Approve</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`roomchange:${request.id}`, () => rejectRoomChange(request.id))} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-50">Reject</button></div></article>,
      })
    }
    if (tab === 'notices') {
      return <AdminMobilePage title="Notices" subtitle={`${notices.length} global notices`} avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)}>
        <div className="space-y-3">
          <AdminNoticeComposer onPost={postNotice} compact />
          {noticesLoading && notices.length === 0 ? <AdminLoadingState label="Loading notices…" /> : notices.length === 0 ? <AdminEmptyState title="No global notices posted" description="Use the form above to publish the first announcement." /> : notices.map(notice => (
            <article key={notice.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${notice.is_urgent ? 'border-red-200' : 'border-slate-100'}`}>
              {notice.image_url && <img src={notice.image_url} alt={notice.title || 'Notice image'} loading="lazy" className="max-h-48 w-full bg-slate-100 object-contain" />}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{notice.title}</p><p className="truncate text-[11px] text-slate-500">{notice.type} / {notice.created_at ? new Date(notice.created_at).toLocaleDateString() : 'N/A'}</p></div>{notice.is_urgent ? <AdminStatusChip tone="red">Urgent</AdminStatusChip> : null}</div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{notice.content}</p>
                <div className="mt-2 flex justify-end"><button onClick={() => deleteNotice(notice.id)} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600">Delete</button></div>
              </div>
            </article>
          ))}
        </div>
      </AdminMobilePage>
    }
    if (tab === 'analytics') {
      return <AdminMobilePage title="Analytics" subtitle="Platform insights" avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)}><AdminAnalytics {...adminAnalytics} /></AdminMobilePage>
    }
    if (tab === 'membership') {
      return <AdminMobilePage title="Membership" subtitle="Owner memberships" avatar="A" onBack={navigateDashboardBack} onProfile={() => setProfileMenuOpen(value => !value)}><MembershipManager owners={membershipOwners} requests={membershipRequests} loading={membershipLoading} processingId={membershipProcessingId} getDaysLeft={getDaysLeft} sendRenewalEmail={sendRenewalEmail} grantMembership={grantMembership} revokeMembership={revokeMembership} reviewRequest={reviewRequest} onRefresh={() => refreshMemberships(false)} /></AdminMobilePage>
    }
    if (process.env.NODE_ENV !== 'production') console.warn('[HostelSet] Unhandled admin mobile view key:', tab)
    return <AdminMobileDashboard stats={statsData} actionCards={actionCenterCards} globalStats={globalStats} realtimeConnected={realtimeConnected} avatar="A" onProfile={() => setProfileMenuOpen(value => !value)} onNavigate={openSection} onRefresh={refreshAdminStats} />
  }
  const renderMountedAdminMobileTabs = () => (
    <div data-admin-mobile-mounted-tabs>
      {ADMIN_PERSISTENT_TABS.filter(tab => mountedTabs.has(tab) || tab === activeTab).map(tab => (
        <AdminTabPanel key={tab} tab={tab} active={activeTab === tab}>
          {renderAdminMobileTab(tab)}
        </AdminTabPanel>
      ))}
      {activeTab === 'enterprise' && (
        <AdminTabPanel tab="enterprise" active>
          {renderAdminMobileTab('enterprise')}
        </AdminTabPanel>
      )}
    </div>
  )

  return (
    <div className="dashboard-shell min-h-screen max-w-full overflow-x-hidden bg-[#f8f9fa] font-sans selection:bg-orange-500 selection:text-white">
      <div className="lg:hidden">
        {renderMountedAdminMobileTabs()}
        <div className="fixed right-3 top-14 z-[70]">
          <AccountMenu open={profileMenuOpen} onClose={()=>setProfileMenuOpen(false)} name="Administrator" subtitle="HostelSet platform" avatar="" fallbackIcon="settings" actions={[{label:'Refresh dashboard',onClick:refreshAdminStats},{label:'Logout',onClick:handleLogout,danger:true}]}/>
        </div>
      </div>
      <DashboardSidebar role="Admin" items={adminSidebarItems} activeId={activeTab} onSelect={openSection} footer={<div><p className="text-sm font-bold text-white">Platform console</p><p className={`mt-1 text-xs ${realtimeConnected?'text-emerald-400':'text-slate-400'}`}>{realtimeConnected?'Live data':'Connecting'}</p></div>}/>
      
      {/* ----- NAVBAR ----- */}
      <nav className="dashboard-desktop-header">
        <div className="container mx-auto flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo priority />
            <span className="text-[10px] sm:text-xs bg-[#2a2a2a] text-orange-400/90 border border-orange-500/30 px-2 sm:px-3 py-1 rounded-full whitespace-nowrap">Admin</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className={`hidden sm:inline-flex items-center gap-2 text-xs font-semibold ${realtimeConnected ? 'text-emerald-400' : 'text-gray-500'}`}>
              <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
              {realtimeConnected ? 'Live' : 'Connecting'}
            </span>
            <ThemeToggle compact />
            <NotificationBell />
            <button type="button" onClick={refreshAdminStats} className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-400 transition hover:text-orange-300"><DashboardIcon name="dashboard" className="h-4 w-4" />Refresh</button>
            <button onClick={handleLogout} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white px-3 sm:px-6 py-2 rounded-full text-sm font-semibold transition shadow-md">Logout</button>
          </div>
        </div>
      </nav>

      <main className="dashboard-main container mx-auto hidden min-w-0 px-3 py-5 sm:px-4 sm:py-8 lg:block">
        {activeTab === 'overview' && <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3"><h1 className="text-lg font-bold text-slate-900">Platform management</h1><p className="text-sm text-slate-500">Search records or open a management section below.</p></div><AdminGlobalSearch onOpen={(group, item) => setSearchDetail({ group, item })} /></section>}
        
        {/* ----- STATS CARDS ----- */}
        {activeTab === 'overview' && <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
          {statsData.map((stat, index) => {
            const targetTab = tabForStat(stat.label);
            const Card = targetTab ? 'button' : 'div';
            return (
            <Card key={index} type={targetTab ? 'button' : undefined} onClick={targetTab ? () => openSection(targetTab) : undefined} className={`bg-white rounded-xl p-3 shadow-sm border border-gray-200 hover:shadow-md hover:border-orange-200 transition flex items-center gap-3 min-w-0 text-left ${targetTab ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400' : ''}`}>
              <div className={`w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-full flex items-center justify-center text-base sm:text-xl shadow-sm ${stat.color}`}>
                <DashboardIcon name={stat.icon} className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div>
                <p className="text-[11px] text-gray-500 uppercase tracking-widest font-semibold">{stat.label}</p>
                {statsLoading ? <Skeleton className="mt-2 h-6 w-16" /> : <p className="text-base sm:text-xl font-bold text-gray-800 tracking-tight truncate">{stat.value}</p>}
              </div>
            </Card>
          )})}
        </div>}
        {activeTab === 'overview' && (
          <AdminActionCenter
            cards={actionCenterCards}
            membershipRequests={pendingMembershipRequests}
            applications={pendingApplications}
            complaints={openComplaints}
            vacateRequests={pendingVacateRequests}
            roomChanges={pendingRoomChanges}
            notices={overviewNotices}
            noticeCount={overviewCounts.notices}
            paymentIssueCount={overviewCounts.paymentIssues}
            onOpen={openSection}
            onReviewMembership={(requestId, approve) => runAdminAction(`membership:${requestId}`, async () => {
              const reviewed = await reviewRequest(requestId, approve)
              if (reviewed) await refreshAdminStats()
            })}
            processingId={membershipProcessingId || actionKey}
          />
        )}

        {/* ----- TABS ----- */}
        <div className="hidden"><DashboardSectionNav label="Admin dashboard sections" items={tabs} activeId={activeTab} onSelect={openSection} /></div>
        <div ref={sectionRef} className="scroll-mt-28">
        {/* ----- OVERVIEW ----- */}
        {mountedTabs.has('enterprise') && (
          <AdminTabPanel tab="enterprise" active={activeTab === 'enterprise'}>
            <EnterpriseAdminConsole />
          </AdminTabPanel>
        )}
        {mountedTabs.has('global-search') && (
          <AdminTabPanel tab="global-search" active={activeTab === 'global-search'}>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="mb-2 text-lg font-bold text-slate-900">Global search</h2><p className="mb-4 text-sm text-slate-500">Search platform records and open matching details.</p><AdminGlobalSearch onOpen={(group, item) => setSearchDetail({ group, item })} /></div>
          </AdminTabPanel>
        )}
        {mountedTabs.has('analytics') && (
          <AdminTabPanel tab="analytics" active={activeTab === 'analytics'}>
            <AdminAnalytics {...adminAnalytics} />
          </AdminTabPanel>
        )}


        {/* ----- PROPERTIES ----- */}
        {mountedTabs.has('properties') && (
          <AdminTabPanel tab="properties" active={activeTab === 'properties'}>
          <AdminTable
            loading={propertiesLoading}
            headers={['Property Name', 'Owner', 'Status', 'Property ID (UUID)', 'Actions']}
            data={properties}
            renderRow={(p) => (
              <tr key={p.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{p.name}</td>
                <td className="px-6 py-4">{p.users?.full_name || 'N/A'}</td>
                <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${p.archived_at || p.lifecycle_status === 'archived' ? 'bg-amber-100 text-amber-800' : p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{p.archived_at || p.lifecycle_status === 'archived' ? 'Archived' : p.is_active ? 'Active' : 'Inactive'}</span></td>
                <td className="px-6 py-4 font-mono text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 inline-block">{p.id}</td>
                <td className="px-6 py-4 flex gap-2">
                  <button type="button" onClick={() => viewPropertyDetails(p)} className="text-blue-600 hover:text-blue-800 font-semibold text-xs uppercase tracking-wider">View</button>
                  {p.archived_at || p.lifecycle_status === 'archived' ? (
                    <button type="button" onClick={() => restoreProperty(p.id)} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider">Restore</button>
                  ) : (
                    <button type="button" onClick={() => archiveProperty(p.id)} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider">Archive</button>
                  )}
                </td>
              </tr>
            )}
            emptyMessage="No properties registered yet."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- TENANTS ----- */}
        {mountedTabs.has('tenants') && (
          <AdminTabPanel tab="tenants" active={activeTab === 'tenants'}>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3">
              <p className="text-sm text-gray-500"><span className="font-bold text-slate-800">{tenants.length}</span> tenant{tenants.length !== 1 ? 's' : ''} visible to this admin</p>
              {tenantsError && <p className="text-xs text-red-600">Database error: {tenantsError}</p>}
            </div>
            <AdminTable
              loading={tenantsLoading}
              headers={['Tenant', 'Email', 'Phone', 'Blood Group', 'Room', 'Property', 'Status', 'Tenant UUID', 'Actions']}
              data={tenants}
              renderRow={(t) => (
                <tr key={t.id} className="hover:bg-orange-50/50 transition">
                  <td className="px-6 py-4 font-semibold text-gray-800">{t.name}</td>
                  <td className="px-6 py-4 text-gray-500">{t.email || 'N/A'}</td>
                  <td className="px-6 py-4 text-gray-500">{t.phone}</td>
                  <td className="px-6 py-4 text-gray-500">{displayBloodGroup(t.blood_group)}</td>
                  <td className="px-6 py-4 text-gray-500">{t.rooms?.room_number || 'N/A'}</td>
                  <td className="px-6 py-4 text-gray-500">{t.property?.name || 'N/A'}</td>
                  <td className="px-6 py-4"><span className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{(t.status || 'unknown').replaceAll('_', ' ')}</span></td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{t.id}</td>
                  <td className="px-6 py-4 flex gap-2">
                    <button type="button" onClick={() => setSearchDetail({ group: 'Tenant', item: t })} className="text-blue-600 hover:text-blue-800 font-semibold text-xs uppercase tracking-wider">View</button>
                    {t.status === 'inactive' ? null : <button type="button" onClick={() => deleteTenant(t.id, t.user_id)} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider">Vacate / Archive</button>}
                  </td>
                </tr>
              )}
              emptyMessage="No tenant rows are visible. Apply the admin RLS migration if tenants exist in Supabase."
            />
          </div>
        
          </AdminTabPanel>
        )}

        {/* ----- OWNERS ----- */}
        {mountedTabs.has('owners') && (
          <AdminTabPanel tab="owners" active={activeTab === 'owners'}>
          <AdminTable
            loading={ownersLoading}
            headers={['Owner Name', 'Email', 'Owner ID (UUID)', 'Status', 'Actions']}
            data={owners}
            renderRow={(o) => (
              <tr key={o.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{o.full_name}</td>
                <td className="px-6 py-4 text-gray-500">{o.email}</td>
                <td className="px-6 py-4 font-mono text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 inline-block">{o.id}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${o.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {o.is_active ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td className="px-6 py-4 flex gap-2">
                  <button onClick={() => viewOwnerDetails(o)} className="text-blue-600 hover:text-blue-800 font-semibold text-xs uppercase tracking-wider">View</button>
                  <button onClick={() => toggleOwnerStatus(o.id, o.is_active)} className={`font-semibold text-xs uppercase tracking-wider ${o.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}>
                    {o.is_active ? 'Suspend' : 'Activate'}
                  </button>
                </td>
              </tr>
            )}
            emptyMessage="No owners registered yet."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- USERS ----- */}
        {mountedTabs.has('users') && (
          <AdminTabPanel tab="users" active={activeTab === 'users'}>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-gray-100 pb-4">
              <h3 className="text-lg font-bold text-[#1a1a1a]">User Management</h3>
              <div className="flex gap-4 w-full md:w-auto">
                <input 
                  type="text" 
                  placeholder="Search name, email, phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 text-sm w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="border border-gray-300 rounded-lg px-4 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                  <option value="tenant">Tenant</option>
                </select>
              </div>
            </div>

            <AdminTable
              loading={usersLoading}
              headers={['Full Name', 'Email', 'Role', 'Status', 'Actions']}
              data={users}
              renderRow={(u) => (
                <tr key={u.id} className="hover:bg-orange-50/50 transition">
                  <td className="px-6 py-4 font-semibold text-gray-800">{u.full_name || 'N/A'}</td>
                  <td className="px-6 py-4 text-gray-500">{u.email}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      u.role === 'admin' ? 'bg-red-100 text-red-700' :
                      u.role === 'owner' ? 'bg-orange-100 text-orange-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 flex flex-wrap gap-2">
                    <button 
                      onClick={() => toggleUserStatus(u.id, u.is_active)} 
                      className={`font-semibold text-xs uppercase tracking-wider ${u.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <select
                      onChange={(e) => changeUserRole(u.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                      defaultValue=""
                    >
                      <option value="" disabled>Change Role</option>
                      <option value="tenant">Tenant</option>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              )}
              emptyMessage="No users found matching your search."
            />
          </div>
        
          </AdminTabPanel>
        )}

        {/* ----- PAYMENTS ----- */}
        {mountedTabs.has('payments') && (
          <AdminTabPanel tab="payments" active={activeTab === 'payments'}>
          <AdminTable
            loading={paymentsLoading}
            headers={['Tenant', 'Amount', 'Date', 'Status', 'Actions']}
            data={payments}
            renderCard={(p) => (
              <div key={p.id} className="rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold leading-tight text-slate-900">{p.tenants?.name || 'Unknown'}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{new Date(p.payment_date).toLocaleDateString()}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-emerald-600">{formatCurrency(p.amount)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.status === 'success' ? 'bg-emerald-100 text-emerald-700' : p.status === 'payment_pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{p.status === 'payment_pending' ? 'Pending' : p.status}</span>
                  <div className="flex shrink-0 gap-2">{p.payment_screenshot ? <button type="button" onClick={() => openSignedPaymentProof(p)} className="text-xs font-semibold text-blue-600">Proof</button> : null}{p.status === 'payment_pending' && <><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`payment:${p.id}`, () => confirmPayment(p.id))} className="text-xs font-semibold text-emerald-600 disabled:opacity-50">Confirm</button><button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`payment:${p.id}`, () => rejectPayment(p.id))} className="text-xs font-semibold text-red-500 disabled:opacity-50">Reject</button></>}</div>
                </div>
              </div>
            )}
            renderRow={(p) => (
              <tr key={p.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{p.tenants?.name || 'Unknown'}</td>
                <td className="px-6 py-4 text-emerald-600 font-bold">{formatCurrency(p.amount)}</td>
                <td className="px-6 py-4 text-gray-500">{new Date(p.payment_date).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${p.status === 'success' ? 'bg-emerald-100 text-emerald-700' : p.status === 'payment_pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {p.status === 'payment_pending' ? 'Pending' : p.status}
                  </span>
                </td>
                <td className="px-6 py-4 flex gap-2">
                  {p.payment_screenshot && <button type="button" onClick={() => openSignedPaymentProof(p)} className="text-blue-600 hover:text-blue-800 font-semibold text-xs uppercase tracking-wider">Proof</button>}
                  {p.status === 'payment_pending' && (
                    <>
                      <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`payment:${p.id}`, () => confirmPayment(p.id))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `payment:${p.id}` ? 'Processing...' : 'Confirm'}</button>
                      <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`payment:${p.id}`, () => rejectPayment(p.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `payment:${p.id}` ? 'Processing...' : 'Reject'}</button>
                    </>
                  )}
                </td>
              </tr>
            )}
            emptyMessage="No payments found."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- PRE-BOOKINGS ----- */}
        {mountedTabs.has('prebookings') && (
          <AdminTabPanel tab="prebookings" active={activeTab === 'prebookings'}>
          <AdminTable
            loading={preBookingsLoading}
            headers={['Name', 'Room', 'Property', 'Fee', 'Actions']}
            data={preBookings}
            renderRow={(b) => (
              <tr key={b.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{b.name}</td>
                <td className="px-6 py-4 text-gray-500">{b.rooms?.room_number || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{b.rooms?.properties?.name || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{formatCurrency(b.pre_booking_fee_amount || 0)}</td>
                <td className="px-6 py-4 flex gap-2">
                  {b.status === 'pending' ? <>
                    <button disabled={Boolean(actionKey) || (Number(reservationCountsByRoom[b.room_id] || 0) >= Number(b.rooms?.capacity || 0))} onClick={() => runAdminAction(`prebooking:${b.id}`, () => approvePreBooking(b.id, b.user_id, b.room_id, b.property_id, b.name, b.phone, b.email, b.rooms?.monthly_rent))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `prebooking:${b.id}` ? 'Processing...' : Number(reservationCountsByRoom[b.room_id] || 0) >= Number(b.rooms?.capacity || 0) ? 'Capacity reached' : 'Reserve'}</button>
                    <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`prebooking:${b.id}`, () => rejectPreBooking(b.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `prebooking:${b.id}` ? 'Processing...' : 'Reject'}</button>
                  </> : <span className="text-xs font-semibold text-purple-700">{b.status === 'reserved' ? 'Waiting for vacancy' : 'Converted'}</span>}
                </td>
              </tr>
            )}
            emptyMessage="No pre-bookings found."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- APPLICATIONS ----- */}
        {mountedTabs.has('applications') && (
          <AdminTabPanel tab="applications" active={activeTab === 'applications'}>
          <AdminTable
            loading={applicationsLoading}
            headers={['Applicant', 'Room', 'Rent / Deposit', 'Payment Verification', 'Actions']}
            data={applications}
            renderRow={(a) => (
              <tr key={a.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4"><p className="font-semibold text-gray-800">{a.name}</p><p className="text-sm text-gray-500">{a.phone}</p></td>
                <td className="px-6 py-4 text-gray-500">{a.rooms?.room_number || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500"><p>Rent: {formatCurrency(a.rooms?.monthly_rent || 0)}</p><p>Deposit: {formatCurrency(a.payment_amount || 0)}</p></td>
                <td className="px-6 py-4 text-sm text-gray-500"><p>UTR: <span className="font-medium text-slate-700">{a.payment_transaction_id || a.upi_transaction_id || 'Not provided'}</span></p><p>Submitted: {new Date(a.payment_date || a.created_at).toLocaleDateString()}</p><p className="capitalize">Status: {(a.payment_status || 'pending verification').replaceAll('_', ' ')}</p>{a.payment_screenshot ? <button type="button" onClick={() => openSignedApplicationProof(a)} className="mt-2 rounded-lg border border-blue-200 px-3 py-1.5 font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">View payment proof</button> : <p className="mt-1 text-xs text-red-500">Proof unavailable</p>}</td>
                <td className="px-6 py-4 flex gap-2">
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`application:${a.id}`, () => approveApplication(a, a.user_id))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `application:${a.id}` ? 'Processing...' : 'Approve'}</button>
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`application:${a.id}`, () => rejectApplication(a.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `application:${a.id}` ? 'Processing...' : 'Reject'}</button>
                </td>
              </tr>
            )}
            emptyMessage="No pending applications."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- APPROVED APPLICATIONS ----- */}
        {mountedTabs.has('approvedapps') && (
          <AdminTabPanel tab="approvedapps" active={activeTab === 'approvedapps'}>
          <AdminTable
            loading={approvedAppsLoading}
            headers={['Name', 'Room', 'Status', 'Processed']}
            data={approvedApps}
            renderRow={(a) => (
              <tr key={a.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{a.name}</td>
                <td className="px-6 py-4 text-gray-500">{a.rooms?.room_number || 'N/A'}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${a.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-500">{a.processed_at ? new Date(a.processed_at).toLocaleDateString() : 'N/A'}</td>
              </tr>
            )}
            emptyMessage="No processed applications yet."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- COMPLAINTS ----- */}
        {mountedTabs.has('complaints') && (
          <AdminTabPanel tab="complaints" active={activeTab === 'complaints'}>
          <AdminTable
            loading={complaintsLoading}
            headers={['Title', 'Tenant', 'Status', 'Actions']}
            data={complaints}
            renderRow={(c) => (
              <tr key={c.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{c.title}</td>
                <td className="px-6 py-4 text-gray-500">{c.tenants?.name || 'N/A'}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${c.status === 'open' ? 'bg-red-100 text-red-700' : c.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-6 py-4 flex gap-2">
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`complaint:${c.id}`, () => resolveComplaint(c.id))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `complaint:${c.id}` ? 'Processing...' : 'Resolve'}</button>
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`complaint:${c.id}`, () => deleteComplaint(c.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `complaint:${c.id}` ? 'Processing...' : 'Delete'}</button>
                </td>
              </tr>
            )}
            emptyMessage="No complaints in the system."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- VACATE ----- */}
        {mountedTabs.has('vacate') && (
          <AdminTabPanel tab="vacate" active={activeTab === 'vacate'}>
          <AdminTable
            loading={vacateLoading}
            headers={['Tenant', 'Room', 'Checkout Date', 'Status', 'Actions']}
            data={vacateRequests}
            renderRow={(v) => (
              <tr key={v.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{v.tenants?.name || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{v.tenants?.rooms?.room_number || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{new Date(v.expected_check_out).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${v.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {v.status}
                  </span>
                </td>
                <td className="px-6 py-4 flex gap-2">
                  {v.status === 'pending' && (
                    <>
                      <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`vacate:${v.id}`, () => approveVacate(v.id, v.tenant_id, v.expected_check_out))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `vacate:${v.id}` ? 'Processing...' : 'Approve'}</button>
                      <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`vacate:${v.id}`, () => rejectVacate(v.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `vacate:${v.id}` ? 'Processing...' : 'Reject'}</button>
                    </>
                  )}
                </td>
              </tr>
            )}
            emptyMessage="No vacate requests found."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- ROOM CHANGE ----- */}
        {mountedTabs.has('roomchange') && (
          <AdminTabPanel tab="roomchange" active={activeTab === 'roomchange'}>
          <AdminTable
            loading={roomChangesLoading}
            headers={['Tenant', 'Old Room', 'New Room', 'Actions']}
            data={roomChanges}
            renderRow={(r) => (
              <tr key={r.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800">{r.tenants?.name || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{r.old_room?.room_number || 'N/A'}</td>
                <td className="px-6 py-4 text-gray-500">{r.new_room?.room_number || 'N/A'}</td>
                <td className="px-6 py-4 flex gap-2">
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`roomchange:${r.id}`, () => approveRoomChange(r.id, r.tenant_id, r.new_room_id, r.old_room_id))} className="text-emerald-600 hover:text-emerald-800 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `roomchange:${r.id}` ? 'Processing...' : 'Approve'}</button>
                  <button disabled={Boolean(actionKey)} onClick={() => runAdminAction(`roomchange:${r.id}`, () => rejectRoomChange(r.id))} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider disabled:opacity-50">{actionKey === `roomchange:${r.id}` ? 'Processing...' : 'Reject'}</button>
                </td>
              </tr>
            )}
            emptyMessage="No room change requests found."
          />
        
          </AdminTabPanel>
        )}

        {/* ----- NOTICES ----- */}
        {mountedTabs.has('notices') && (
          <AdminTabPanel tab="notices" active={activeTab === 'notices'}>
          <div className="space-y-5">
            <AdminNoticeComposer onPost={postNotice} />
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <AdminTable loading={noticesLoading} headers={['Title', 'Type', 'Date', 'Actions']} data={notices} renderRow={(n) => (
              <tr key={n.id} className="hover:bg-orange-50/50 transition">
                <td className="px-6 py-4 font-semibold text-gray-800"><div className="flex items-center gap-3">{n.image_url && <img src={n.image_url} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" />}<span>{n.title} {n.is_urgent && <span className="ml-2 text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full">URGENT</span>}</span></div></td>
                <td className="px-6 py-4 capitalize text-gray-500">{n.type}</td>
                <td className="px-6 py-4 text-gray-500">{new Date(n.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4"><button onClick={() => deleteNotice(n.id)} className="text-red-500 hover:text-red-700 font-semibold text-xs uppercase tracking-wider">Delete</button></td>
              </tr>
            )} emptyMessage="No global notices posted." />
            </div>
          </div>
        
          </AdminTabPanel>
        )}

        {/* ----- MEMBERSHIP MANAGEMENT (USING THE MODULAR COMPONENT) ----- */}
        {mountedTabs.has('membership') && (
          <AdminTabPanel tab="membership" active={activeTab === 'membership'}>
          <MembershipManager 
            owners={membershipOwners}
            requests={membershipRequests}
            loading={membershipLoading}
            processingId={membershipProcessingId}
            getDaysLeft={getDaysLeft}
            sendRenewalEmail={sendRenewalEmail}
            grantMembership={grantMembership}
            revokeMembership={revokeMembership}
            reviewRequest={reviewRequest}
            onRefresh={() => refreshMemberships(false)}
          />
        
          </AdminTabPanel>
        )}
        </div>

      {/* ----- DETAIL MODALS ----- */}
      <DetailModal 
        isOpen={!!selectedProperty} 
        onClose={closeModals} 
        title="Property Details" 
        data={selectedProperty} 
      />
      <DetailModal 
        isOpen={!!selectedOwner} 
        onClose={closeModals} 
        title="Owner Details" 
        data={selectedOwner} 
      />
      <DetailModal
        isOpen={!!searchDetail}
        onClose={() => setSearchDetail(null)}
        title={`${searchDetail?.group || 'Search'} Details`}
        data={searchDetail?.item}
      />
      {applicationProof && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-proof-title" onClick={() => setApplicationProof(null)}><div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={event => event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 id="admin-proof-title" className="font-bold text-slate-900">Payment proof - {applicationProof.name}</h2><button type="button" onClick={() => setApplicationProof(null)} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Close payment proof">Close</button></div><img src={applicationProof.url} alt={`Payment proof submitted by ${applicationProof.name}`} className="mx-auto max-h-[75vh] max-w-full rounded-xl border object-contain" /></div></div>}
    </main>
    <div className="lg:hidden">
      <DetailModal 
        isOpen={!!selectedProperty} 
        onClose={closeModals} 
        title="Property Details" 
        data={selectedProperty} 
      />
      <DetailModal 
        isOpen={!!selectedOwner} 
        onClose={closeModals} 
        title="Owner Details" 
        data={selectedOwner} 
      />
      <DetailModal
        isOpen={!!searchDetail}
        onClose={() => setSearchDetail(null)}
        title={`${searchDetail?.group || 'Search'} Details`}
        data={searchDetail?.item}
      />
      {applicationProof && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-proof-title-mobile" onClick={() => setApplicationProof(null)}><div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={event => event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 id="admin-proof-title-mobile" className="font-bold text-slate-900">Payment proof - {applicationProof.name}</h2><button type="button" onClick={() => setApplicationProof(null)} className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400" aria-label="Close payment proof">Close</button></div><img src={applicationProof.url} alt={`Payment proof submitted by ${applicationProof.name}`} className="mx-auto max-h-[75vh] max-w-full rounded-xl border object-contain" /></div></div>}
      <MobileBottomNav items={adminBottomItems} activeId={mobileMenu==='more'?'more':activeTab === 'global-search' ? 'search' : activeTab} onSelect={id=>{if(id==='more')setMobileMenu('more');else if(id==='search'){setMobileMenu(null);openSection('global-search');resetDashboardScroll()}else openSection(id)}}/>
      <AdminMobileMore open={mobileMenu==='more'} onClose={()=>setMobileMenu(null)} items={adminMoreItems}/>
    </div>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <AdminProvider>
      <AdminDashboardContent />
    </AdminProvider>
  );
}
