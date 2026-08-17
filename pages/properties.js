import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Head from 'next/head'
import { motion } from 'framer-motion'
import { formatCurrency } from '../lib/utils'
import NearbyHostelMap from '../components/maps/NearbyHostelMap'
import { usePublicRealtimeRefresh as useRealtimeRefresh } from '../hooks/usePublicRealtimeRefresh'
import PublicFooter from '../components/PublicFooter'
import { propertyPublicPath } from '../lib/propertySlug'
import {
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  SITE_URL,
  SOCIAL_IMAGE,
  distanceKm,
  markBrowsePerf,
  normalizePublicProperties,
  readBrowseCache,
  writeBrowseCache,
} from '../products/hostels/public/listing'

export default function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [cities, setCities] = useState([])
  const [selectedCity, setSelectedCity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState('list')
  const [userLocation, setUserLocation] = useState(null)
  const [locationStatus, setLocationStatus] = useState('')
  const inFlightRef = useRef(null)

  const filteredProperties = useMemo(() => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : null
    let filtered = properties
    if (selectedCity) filtered = filtered.filter(property => property.city === selectedCity)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(property =>
        property.name.toLowerCase().includes(q) ||
        (property.city && property.city.toLowerCase().includes(q))
      )
    }
    const withDistance = filtered.map(property => ({ ...property, distance: distanceKm(userLocation, property) }))
    if (userLocation) withDistance.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    markBrowsePerf('search-filter', `count=${withDistance.length}`, startedAt)
    return withDistance
  }, [selectedCity, searchQuery, properties, userLocation])

  const loadProperties = useCallback(async (backgroundOrOptions = false) => {
    const options = typeof backgroundOrOptions === 'object'
      ? backgroundOrOptions
      : { background: Boolean(backgroundOrOptions) }
    const background = Boolean(options.background)
    const forceFresh = Boolean(options.forceFresh)
    const reason = options.reason || (background ? 'background-refresh' : 'manual-refresh')
    if (inFlightRef.current) return inFlightRef.current

    const request = (async () => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : null
      markBrowsePerf('fetch-start', `reason=${reason}`)
      if (!background && properties.length === 0) setLoading(true)
      if (background) setRefreshing(true)
      if (!background) setLoadError('')
      try {
        const response = await fetch(
          forceFresh
            ? '/api/public/properties?refresh=1'
            : '/api/public/properties',
          {
            method: 'GET',
            cache: forceFresh ? 'no-store' : 'default',
            headers: {
              Accept: 'application/json',
            },
          }
        )

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load properties')
        }

        const nextProperties = normalizePublicProperties(data)
        setProperties(nextProperties)
        setCities([...new Set(nextProperties.map(property => property.city).filter(Boolean))].sort())
        writeBrowseCache(nextProperties)
        setLoadError('')
        markBrowsePerf('first-usable-property-list', `source=network count=${nextProperties.length}`, startedAt)
      } catch (error) {
        console.error('Error loading properties:', error)
        if (!background || properties.length === 0) {
          setLoadError('Properties could not be loaded. Check your connection and try again.')
        }
      } finally {
        if (!background) setLoading(false)
        setRefreshing(false)
        markBrowsePerf('fetch-end', `reason=${reason}`, startedAt)
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = request
    return request
  }, [properties.length])

  useEffect(() => {
    const cachedProperties = readBrowseCache()

    if (cachedProperties.length) {
      setProperties(cachedProperties)
      setCities(
        [...new Set(cachedProperties.map(property => property.city).filter(Boolean))].sort()
      )
      setLoading(false)
      markBrowsePerf(
        'first-usable-property-list',
        `source=cache count=${cachedProperties.length}`
      )
    }

    loadProperties({
      background: cachedProperties.length > 0,
      reason: 'initial-load',
    })
  }, [])

  useEffect(() => {
    const refreshVisible = () => loadProperties({ background: true, reason: 'visibility-refresh' })
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshVisible() }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadProperties])

  useRealtimeRefresh('public:properties:availability', ['properties', 'rooms'], options => loadProperties({ ...options, forceFresh: true }), true, 120)

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocationStatus('Location is not supported on this device.'); return }
    setLocationStatus('Finding your location...')
    navigator.geolocation.getCurrentPosition(
      position => { setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setLocationStatus('Showing nearest hostels first.'); setView('map') },
      () => setLocationStatus('Location permission was not available. You can still search by city.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  return (
    <>
      <Head>
        <title>{PAGE_TITLE}</title>
        <meta name="description" content={PAGE_DESCRIPTION} />
        <link rel="canonical" href={`${SITE_URL}/properties`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="HostelSet" />
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={PAGE_DESCRIPTION} />
        <meta property="og:url" content={`${SITE_URL}/properties`} />
        <meta property="og:image" content={SOCIAL_IMAGE} />
        <meta property="og:image:alt" content="HostelSet" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={PAGE_TITLE} />
        <meta name="twitter:description" content={PAGE_DESCRIPTION} />
        <meta name="twitter:url" content={`${SITE_URL}/properties`} />
        <meta name="twitter:image" content={SOCIAL_IMAGE} />
      </Head>

      <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
        <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6 sm:py-5">
          <div className="container mx-auto mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-black text-slate-900 dark:text-white">HostelSet</Link>
            <nav className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-600 dark:text-slate-300" aria-label="Browse navigation">
              <Link href="/" className="hover:text-slate-950 dark:hover:text-white">Home</Link>
              <Link href="/faq" className="hover:text-slate-950 dark:hover:text-white">FAQ</Link>
              <Link href="/login/tenant" className="hover:text-slate-950 dark:hover:text-white">Tenant Login</Link>
              <Link href="/register" className="rounded-full bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">Register Your Property</Link>
            </nav>
          </div>
          <div className="container mx-auto text-center">
            <motion.h1 initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white md:text-5xl">
              Find Your Perfect PG
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="mx-auto mb-6 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
              Compare rooms, rent, and facilities. Apply to a hostel first; tenant account access comes after owner approval.
            </motion.p>

            <div className="mx-auto flex max-w-2xl flex-col gap-2.5 sm:flex-row">
              <input
                type="text"
                placeholder="Search by property name or city..."
                className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-950 transition placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-orange-400"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
              />
              <select
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-950 transition focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-orange-400"
                value={selectedCity}
                onChange={event => setSelectedCity(event.target.value)}
              >
                <option value="">All Cities</option>
                {cities.map(city => <option key={city} value={city}>{city}</option>)}
              </select>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button onClick={useMyLocation} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Use my location</button>
              <button onClick={() => setView('list')} className={`min-h-10 rounded-xl px-3 py-2 text-sm font-semibold ${view === 'list' ? 'bg-slate-900 text-white dark:bg-orange-500' : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>List</button>
              <button onClick={() => setView('map')} className={`min-h-10 rounded-xl px-3 py-2 text-sm font-semibold ${view === 'map' ? 'bg-slate-900 text-white dark:bg-orange-500' : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>Map</button>
            </div>
            <div className="mt-3 min-h-5 text-sm text-slate-500 dark:text-slate-400" role="status">{refreshing ? 'Refreshing availability...' : locationStatus}</div>
          </div>
        </div>

        <div className="container mx-auto px-3 py-6 sm:px-4 sm:py-8">
          {loading && properties.length === 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading properties">
              {[0, 1, 2, 3].map(item => (
                <div key={item} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="aspect-[16/9] animate-pulse bg-slate-200 dark:bg-slate-800" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                    <div className="h-9 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="py-16 text-center"><p className="mb-4 text-red-600 dark:text-red-300">{loadError}</p><button onClick={() => loadProperties({ reason: 'retry' })} className="btn-primary">Try again</button></div>
          ) : filteredProperties.length === 0 ? (
            <div className="py-16 text-center"><p className="text-slate-500 dark:text-slate-400">No hostels match these filters right now.</p></div>
          ) : view === 'map' ? (
            <NearbyHostelMap properties={filteredProperties} userLocation={userLocation} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProperties.map((property, index) => (
                <motion.div
                  key={property.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16 }}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-500/40"
                >
                  <div className="relative aspect-[16/9] bg-slate-100 dark:bg-slate-800">
                    {property.firstPhoto ? (
                      <img
                        src={property.firstPhoto}
                        alt={property.name}
                        loading={index < 2 ? 'eager' : 'lazy'}
                        decoding="async"
                        onLoad={() => markBrowsePerf('image-ready', `id=${property.id}`)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400 dark:text-slate-500">HostelSet</div>
                    )}
                    {property.lowestRent && (
                      <div className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-slate-900 shadow-sm dark:bg-slate-950/90 dark:text-white">
                        From {formatCurrency(property.lowestRent)}/mo
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-black text-slate-950 dark:text-white">{property.name}</h3>
                        <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">{property.city || 'Location not specified'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${property.availableRooms > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>{property.availableRooms > 0 ? 'Available' : 'Full'}</span>
                    </div>
                    {property.distance != null && <p className="mb-2 text-xs font-semibold text-blue-700 dark:text-blue-300">{property.distance < 1 ? `${Math.round(property.distance * 1000)} m away` : `${property.distance.toFixed(1)} km away`}</p>}
                    <div className="mb-3 flex justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span>{property.totalRooms} rooms</span>
                      <span>{property.activeTenantCount} active tenant{property.activeTenantCount === 1 ? '' : 's'}</span>
                    </div>
                    <p className={`mb-3 text-xs font-bold ${property.availableRooms > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{property.availableRooms > 0 ? `${property.availableRooms} room${property.availableRooms === 1 ? '' : 's'} with availability` : 'Currently full'}</p>
                    <Link href={propertyPublicPath(property)} className="block min-h-10 w-full rounded-lg bg-orange-600 px-3 py-2.5 text-center text-sm font-black text-white transition hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
                      View Details
                    </Link>
                    {Number.isFinite(property.latitude) && Number.isFinite(property.longitude) && (
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`} target="_blank" rel="noreferrer" className="mt-2 block min-h-9 w-full rounded-lg border border-slate-300 py-2 text-center text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Get Directions</a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
        <PublicFooter />
      </div>
    </>
  )
}

