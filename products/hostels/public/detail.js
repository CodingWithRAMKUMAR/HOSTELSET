export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.hostelset.com').replace(/\/$/, '')
export const DEFAULT_APPLICATION_DEPOSIT = 3000
export const DEFAULT_PREBOOKING_FEE = 3000

export const PUBLIC_ROOM_DETAIL_API_FALLBACK_SELECT = [
  'id',
  'property_id',
  'room_number',
  'sharing_type',
  'monthly_rent',
  'capacity',
  'current_occupants',
  'status',
  'created_at',
  'updated_at',
  'room_audience',
  'deposit_amount',
  'next_vacate_date',
].join(',')

export const normalizeProperty = property => property ? {
  ...property,
  latitude: property.latitude != null ? Number(property.latitude) : null,
  longitude: property.longitude != null ? Number(property.longitude) : null,
} : null

export const settingsFor = (property, settings) => ({
  upi_id: settings?.upi_id || property?.owner_upi_id || '',
  upi_phone: settings?.upi_phone || '',
  advance_months: settings?.advance_months || 1,
  joining_fee: settings?.joining_fee || 0,
  pre_booking_fee: Number(settings?.pre_booking_fee) > 0 ? Number(settings.pre_booking_fee) : DEFAULT_PREBOOKING_FEE,
  application_deposit: Number(settings?.application_deposit) > 0
    ? Number(settings.application_deposit)
    : DEFAULT_APPLICATION_DEPOSIT,
})

export const buildVacateInfo = roomRows => {
  const info = {}
  const today = new Date()
  roomRows.forEach(room => {
    if (!room.next_vacate_date) return
    const vacateDate = new Date(`${room.next_vacate_date}T23:59:59`)
    if (Number.isNaN(vacateDate.getTime())) return
    info[room.id] = {
      daysLeft: Math.ceil((vacateDate - today) / (1000 * 60 * 60 * 24)),
      vacateDate: room.next_vacate_date,
    }
  })
  return info
}

export const buildReservationCounts = roomRows => Object.fromEntries(
  roomRows.map(room => [room.id, Number(room.reserved_prebooking_count || 0)]),
)

export const isMissingPublicRoomsRpc = error => error?.code === 'PGRST202'
  || /get_public_property_rooms/i.test(String(error?.message || ''))

export const fetchPublicPropertyRooms = async (
  supabase,
  propertyId,
  {
    fallbackSelect = '*',
    mapFallbackRoom = room => ({ ...room, reserved_prebooking_count: 0 }),
  } = {},
) => {
  const rpcResult = await supabase.rpc('get_public_property_rooms', { p_property_id: propertyId })
  if (!rpcResult.error) return rpcResult
  if (!isMissingPublicRoomsRpc(rpcResult.error)) return rpcResult

  const fallback = await supabase
    .from('rooms')
    .select(fallbackSelect)
    .eq('property_id', propertyId)
    .in('status', ['vacant', 'occupied'])
    .gt('capacity', 0)
    .order('room_number')
  if (fallback.error) return fallback
  return {
    data: (fallback.data || []).map(mapFallbackRoom),
    error: null,
  }
}
