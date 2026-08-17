import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatCurrency, formatDate, getSharingDetails } from '../../../lib/utils'
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock'
import DashboardIcon from '../../dashboard/DashboardIcon'
import toast from 'react-hot-toast'
import {
  updateOwnerRoom,
  validateOwnerRoomSettings,
} from '../../../products/hostels/owner/rooms'

export default function OwnerMobileRoomDetailsSheet({ room, tenants = [], onClose, onUpdated, onAddTenant }) {
  useBodyScrollLock(Boolean(room))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ room_number: '', monthly_rent: 0, capacity: 1, sharing_type: 'single', room_audience: 'coliving' })

  useEffect(() => {
    if (!room) return
    setEditing(false)
    setForm({
      room_number: room.room_number || '',
      monthly_rent: room.monthly_rent ?? 0,
      capacity: room.capacity ?? 1,
      sharing_type: room.sharing_type || 'single',
      room_audience: room.room_audience || 'coliving',
    })
  }, [room?.id])

  if (!room) return null

  const occupied = Number(room.current_occupants || tenants.length || 0)
  const capacity = Math.max(1, Number(room.capacity || 1))
  const slots = Math.max(0, capacity - occupied)
  const pct = Math.min(100, (occupied / capacity) * 100)
  const sharing = getSharingDetails(room.sharing_type)
  const rentBadge = (tenant) => tenant.rentSummary || tenant.dueStatus || {}

  const saveRoom = async () => {
    if (saving) return
    const validation = validateOwnerRoomSettings(form, occupied)
    if (!validation.valid) return toast.error(validation.message)
    setSaving(true)
    try {
      const data = await updateOwnerRoom(supabase, room, form, occupied)
      await onUpdated?.(data)
      setEditing(false)
      toast.success('Room updated')
    } catch (error) {
      toast.error('Failed to update room: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[105] bg-slate-950 text-white" role="dialog" aria-modal="true">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950 px-3 pt-[calc(env(safe-area-inset-top)_+_0.25rem)] pb-1">
        <div className="flex min-h-[42px] items-center gap-2">
          <button type="button" onClick={editing ? () => setEditing(false) : onClose} className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10" aria-label="Back">←</button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-black">{editing ? 'Edit Room' : 'Room Details'}</p>
            <p className="truncate text-[10px] text-slate-400">Room {room.room_number}</p>
          </div>
          {!editing && <button type="button" onClick={() => setEditing(true)} className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500 text-xs font-black" aria-label="Edit room">✎</button>}
        </div>
      </header>

      {!editing ? (
        <main className="mx-auto max-w-md space-y-2 overflow-y-auto px-3 py-2 pb-[calc(5.1rem_+_env(safe-area-inset-bottom))]">
          <section className="rounded-3xl border border-white/10 bg-slate-900 p-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-300"><DashboardIcon name="rooms" className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-black">Room {room.room_number}</h2>
                <p className="truncate text-xs text-slate-400">{sharing?.label || 'Room'} · {room.room_audience || 'co-living'}</p>
              </div>
              <span className="rounded-full bg-orange-500/15 px-2 py-1 text-[11px] font-black text-orange-300">{occupied}/{capacity}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} /></div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            {[['Monthly rent', formatCurrency(room.monthly_rent || 0)], ['Deposit', '₹3,000'], ['Occupants', occupied], ['Slots', slots]].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white p-2.5 text-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="truncate text-base font-black">{value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-black">Current residents</h3>
              <button type="button" onClick={onAddTenant} className="h-8 rounded-xl bg-orange-500 px-3 text-xs font-black">+ Add Tenant</button>
            </div>
            {tenants.length === 0 ? <p className="rounded-2xl bg-white/5 p-3 text-center text-xs text-slate-400">No residents in this room.</p> : tenants.map(tenant => (
              <article key={tenant.id} className="flex items-center gap-2 rounded-2xl bg-white/5 p-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black">{tenant.name?.charAt(0) || '?'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{tenant.name}</p>
                  <p className="truncate text-[11px] text-slate-400">{tenant.phone || 'No phone'} · Joined {formatDate(tenant.move_in_date)}</p>
                </div>
                <span className={`max-w-[7rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold ${rentBadge(tenant).status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' : rentBadge(tenant).status === 'pending_confirmation' ? 'bg-purple-500/15 text-purple-200' : 'bg-orange-500/15 text-orange-200'}`}>{rentBadge(tenant).label || tenant.rent_status || 'Unknown'}</span>
              </article>
            ))}
          </section>
        </main>
      ) : (
        <main className="flex h-[calc(100dvh-48px)] flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
            <input className="h-9 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm outline-none" value={form.room_number} onChange={e => setForm({ ...form, room_number: e.target.value })} placeholder="Room number" />
            <input type="number" min="0" className="h-9 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm outline-none" value={form.monthly_rent} onChange={e => setForm({ ...form, monthly_rent: e.target.value })} placeholder="Monthly rent" />
            <input type="number" min={Math.max(1, occupied)} className="h-9 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm outline-none" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Capacity" />
            <select className="h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm outline-none" value={form.sharing_type} onChange={e => setForm({ ...form, sharing_type: e.target.value })}>
              <option value="single">Single Sharing</option><option value="double">Double Sharing</option><option value="triple">Triple Sharing</option><option value="four">Four Sharing</option><option value="five">Five Sharing</option>
            </select>
            <select className="h-9 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm outline-none" value={form.room_audience} onChange={e => setForm({ ...form, room_audience: e.target.value })}>
              <option value="boys">Boys Room</option><option value="girls">Girls Room</option><option value="coliving">Co-living Room</option>
            </select>
          </div>
          <footer className="flex gap-2 border-t border-white/10 bg-slate-950 p-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]">
            <button type="button" onClick={saveRoom} disabled={saving} className="h-9 flex-1 rounded-xl bg-orange-500 text-sm font-black disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setEditing(false)} className="h-9 flex-1 rounded-xl bg-white/10 text-sm font-black">Cancel</button>
          </footer>
        </main>
      )}
    </div>
  )
}
