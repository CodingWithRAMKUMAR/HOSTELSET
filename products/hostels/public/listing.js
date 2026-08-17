export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.hostelset.com').replace(/\/$/, '')
export const PAGE_TITLE = 'Browse Hostels and PGs | HostelSet'
export const PAGE_DESCRIPTION = 'Search active hostel and PG properties on HostelSet by city, room availability, rent, and location.'
export const SOCIAL_IMAGE = `${SITE_URL}/brand/logo-primary.png`
export const BROWSE_CACHE_KEY = 'hostelsetBrowseProperties:v2'
export const BROWSE_CACHE_TTL_MS = 5 * 60 * 1000

export const markBrowsePerf = (label, detail = '', startedAt = null) => {
  if (typeof window === 'undefined' || window.localStorage?.getItem('hostelsetBrowsePerf') !== '1' || typeof performance === 'undefined') return
  const elapsed = typeof startedAt === 'number' ? ` ${Math.round(performance.now() - startedAt)}ms` : ''
  console.info(`[BrowseHostels] ${label}${elapsed}${detail ? ` ${detail}` : ''}`)
}

export const readBrowseCache = () => {
  if (typeof window === 'undefined') return []
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(BROWSE_CACHE_KEY) || 'null')
    if (!cached?.savedAt || Date.now() - cached.savedAt > BROWSE_CACHE_TTL_MS) return []
    return Array.isArray(cached.properties) ? cached.properties : []
  } catch {
    return []
  }
}

export const writeBrowseCache = properties => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(BROWSE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), properties }))
  } catch {}
}

export const normalizePublicProperties = rows => (rows || []).map(property => ({
  ...property,
  latitude: property.latitude == null ? null : Number(property.latitude),
  longitude: property.longitude == null ? null : Number(property.longitude),
  totalRooms: Number(property.total_rooms || 0),
  availableRooms: Number(property.available_room_count || 0),
  activeTenantCount: Number(property.active_tenant_count || 0),
  lowestRent: property.lowest_rent == null ? null : Number(property.lowest_rent),
  firstPhoto: property.photos && property.photos.length > 0 ? property.photos[0] : null,
}))

export function distanceKm(origin, property) {
  if (!origin || !Number.isFinite(property.latitude) || !Number.isFinite(property.longitude)) return null
  const radians = value => value * Math.PI / 180
  const dLat = radians(property.latitude - origin.latitude)
  const dLon = radians(property.longitude - origin.longitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(property.latitude)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
