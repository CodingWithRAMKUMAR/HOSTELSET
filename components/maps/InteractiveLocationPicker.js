import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const markerIcon = L.divIcon({
  className: '',
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#f97316;border:3px solid white;box-shadow:0 3px 10px #0005;transform:rotate(-45deg)"><span style="display:block;width:8px;height:8px;background:white;border-radius:50%;margin:7px"></span></div>',
  iconSize: [28, 28], iconAnchor: [14, 28],
})

function MapController({ value, onChange }) {
  const map = useMap()
  useEffect(() => {
    if (value?.latitude && value?.longitude) map.flyTo([value.latitude, value.longitude], 16, { duration: 0.18 })
  }, [value?.latitude, value?.longitude, map])
  useMapEvents({
    click(event) {
      onChange({ ...value, latitude: event.latlng.lat, longitude: event.latlng.lng, location_place_id: null })
    },
  })
  return value?.latitude && value?.longitude ? <Marker position={[value.latitude, value.longitude]} icon={markerIcon} /> : null
}

export default function InteractiveLocationPicker({ value, onChange }) {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  const [query, setQuery] = useState(value?.formatted_address || '')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!key || query.trim().length < 3 || query === value?.formatted_address) { setResults([]); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete')
        url.searchParams.set('text', query.trim())
        url.searchParams.set('filter', 'countrycode:in')
        url.searchParams.set('limit', '5')
        url.searchParams.set('apiKey', key)
        const response = await fetch(url, { signal: controller.signal })
        const data = await response.json()
        setResults(data.features || [])
      } catch (error) {
        if (error.name !== 'AbortError') setResults([])
      } finally { setSearching(false) }
    }, 350)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, key, value?.formatted_address])

  const choose = feature => {
    const [longitude, latitude] = feature.geometry.coordinates
    const next = {
      latitude, longitude,
      formatted_address: feature.properties.formatted,
      location_place_id: feature.properties.place_id || null,
      city: feature.properties.city || feature.properties.county || '',
      pincode: feature.properties.postcode || '',
    }
    setQuery(next.formatted_address); setResults([]); onChange(next)
  }

  if (!key) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Map configuration is missing. Add NEXT_PUBLIC_GEOAPIFY_API_KEY and restart the app.</div>

  return <div className="space-y-3">
    <div className="relative">
      <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="property-location-search">Search exact property location *</label>
      <input id="property-location-search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" placeholder="Search building, road or landmark" className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:border-slate-800 focus:outline-none" />
      {searching && <span className="absolute right-4 top-10 text-xs text-slate-400">Searching…</span>}
      {results.length > 0 && <div className="absolute z-[1001] mt-1 max-h-56 w-full overflow-y-auto rounded-xl border bg-white shadow-xl">
        {results.map(feature => <button type="button" key={feature.properties.place_id || feature.properties.formatted} onClick={() => choose(feature)} className="block w-full border-b px-4 py-3 text-left text-sm hover:bg-slate-50 last:border-0">{feature.properties.formatted}</button>)}
      </div>}
    </div>
    <div className="h-64 overflow-hidden rounded-xl border sm:h-72">
      <MapContainer center={value?.latitude ? [value.latitude, value.longitude] : [20.5937, 78.9629]} zoom={value?.latitude ? 16 : 5} className="h-full w-full" scrollWheelZoom>
        <TileLayer attribution='&copy; OpenStreetMap contributors | Powered by <a href="https://www.geoapify.com/">Geoapify</a>' url={`https://maps.geoapify.com/v1/tile/positron/{z}/{x}/{y}.png?apiKey=${key}`} />
        <MapController value={value} onChange={onChange} />
      </MapContainer>
    </div>
    <p className="text-xs text-slate-500">Choose a search result, then tap the map to adjust the entrance pin precisely.</p>
  </div>
}
