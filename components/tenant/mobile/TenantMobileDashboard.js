import MobileTopbar from '../../dashboard/MobileTopbar'
import { formatCurrency, formatDate, formatRentDueDetail, formatRentDueLabel, getSharingDetails } from '../../../lib/utils'

function Header({ title, subtitle, avatar, avatarUrl, avatarAlt, onProfile }) {
  return (
    <MobileTopbar title={title} subtitle={subtitle} isHome onProfile={onProfile} avatar={avatar} avatarUrl={avatarUrl} avatarAlt={avatarAlt} />
  )
}

function Stat({ label, value, onClick }) {
  const Card = onClick ? 'button' : 'div'
  return (
    <Card type={onClick ? 'button' : undefined} onClick={onClick} className="min-w-0 rounded-2xl border border-white/10 bg-white p-2 text-left shadow-sm">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-lg font-black leading-tight text-slate-900">{value}</p>
    </Card>
  )
}

function formatNextDue(rentStatus) {
  return formatRentDueDetail(rentStatus, formatDate)
}

export default function TenantMobileDashboard({ tenant, room, property, roommates = [], notices = [], complaints = [], rentStatus = {}, existingVacateRequest, pendingRoomChangeRequest, avatar = 'U', avatarUrl, avatarAlt, onProfile, onNavigate, onPayRent, canPayRent = false, paymentActionLabel = 'Pay rent' }) {
  return (
    <div className="max-w-full overflow-x-hidden bg-slate-950 pb-[calc(5.1rem_+_env(safe-area-inset-bottom))]">
      <Header title="HostelSet" subtitle={property?.name} avatar={avatar} avatarUrl={avatarUrl} avatarAlt={avatarAlt} onProfile={onProfile} />
      <main className="mx-auto max-w-md space-y-2 px-3 py-2">
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-2.5 text-white shadow-sm">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-orange-300">Welcome</p>
              <h1 className="truncate text-base font-black">{tenant?.name || 'Tenant'}</h1>
              <p className="truncate text-xs text-slate-400">Room {room?.room_number || '—'} · {getSharingDetails(room?.sharing_type || '')?.label || 'Room'}</p>
              <p className="mt-1 truncate text-[11px] font-bold text-orange-200">{formatNextDue(rentStatus)}</p>
            </div>
            <span className="max-w-[42%] truncate rounded-full bg-white/10 px-2 py-1 text-[11px] font-bold">{formatRentDueLabel(rentStatus) || 'Active'}</span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Stat label="Monthly rent" value={formatCurrency(tenant?.rent_amount || 0)} onClick={() => onNavigate('payments')} />
          {tenant?.scheduled_rent_amount != null &&
            tenant?.scheduled_rent_effective_period &&
            Number(tenant.scheduled_rent_amount) !== Number(tenant.rent_amount) && (
              <button
                type="button"
                onClick={() => onNavigate('payments')}
                className="col-span-2 rounded-2xl border border-orange-200 bg-orange-50 p-2 text-left shadow-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-600">
                  Scheduled rent change
                </p>
                <p className="text-sm font-black text-slate-900">
                  {formatCurrency(tenant.scheduled_rent_amount)}
                </p>
                <p className="text-[11px] text-slate-600">
                  Effective from {formatDate(tenant.scheduled_rent_effective_period)}
                </p>
              </button>
            )}
          <Stat label="Pending" value={formatCurrency(tenant?.rentSummary?.dueAmount ?? tenant?.dueStatus?.dueAmount ?? tenant?.pending_amount ?? 0)} onClick={() => onNavigate('payments')} />
          <Stat label="Total paid" value={formatCurrency(tenant?.total_paid || 0)} onClick={() => onNavigate('payments')} />
          <Stat label="Deposit" value={formatCurrency(tenant?.security_deposit_amount || 0)} />
          <Stat label="Roommates" value={roommates.length} onClick={() => onNavigate('roommates')} />
          <Stat label="Notices" value={notices.length} onClick={() => onNavigate('notices')} />
          <Stat label="Complaints" value={complaints.length} onClick={() => onNavigate('complaints')} />
        </section>

        <section className="rounded-2xl border border-white/10 bg-white p-2 shadow-sm">
          <p className="mb-2 text-xs font-black text-slate-900">Quick actions</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onPayRent} disabled={!canPayRent} className="h-8 rounded-xl bg-orange-500 px-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">{paymentActionLabel}</button>
            <button type="button" onClick={() => onNavigate('complaints')} className="h-8 rounded-xl bg-slate-50 px-2 text-xs font-bold text-slate-700">Complaint</button>
            <button type="button" onClick={() => onNavigate('room-change')} className="h-8 rounded-xl bg-slate-50 px-2 text-xs font-bold text-slate-700">{pendingRoomChangeRequest ? 'Move pending' : 'Room change'}</button>
            <button type="button" onClick={() => onNavigate('vacate')} className="h-8 rounded-xl bg-slate-50 px-2 text-xs font-bold text-slate-700">{existingVacateRequest ? 'Vacate status' : 'Vacate'}</button>
          </div>
        </section>
      </main>
    </div>
  )
}
