import 'leaflet/dist/leaflet.css'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import Link from 'next/link'
import { useEffect } from 'react'
import { formatCurrency } from '../../lib/utils'
import { propertyPublicPath } from '../../lib/propertySlug'

const hostelIcon = L.divIcon({ className: '', html: '<div style="background:#0f172a;color:white;border:3px solid white;border-radius:18px;padding:5px 9px;box-shadow:0 3px 12px #0005;font-weight:700;white-space:nowrap">PG</div>', iconSize: [42, 30], iconAnchor: [21, 30] })
const userIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;background:#2563eb;border:4px solid white;border-radius:50%;box-shadow:0 0 0 4px #2563eb55"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })

function Fit({ properties, userLocation }) {
  const map = useMap()
  useEffect(() => {
    const points = properties
      .map(p => [Number(p.latitude), Number(p.longitude)])
      .filter(p => p.every(Number.isFinite))
    if (userLocation && Number.isFinite(Number(userLocation.latitude)) && Number.isFinite(Number(userLocation.longitude))) {
      points.push([Number(userLocation.latitude), Number(userLocation.longitude)])
    }
    if (points.length === 1) map.setView(points[0], 14)
    else if (points.length > 1) map.fitBounds(points, { padding: [35, 35], maxZoom: 15 })
  }, [properties, userLocation, map])
  return null
}

export default function NearbyHostelMapClient({ properties, userLocation, compact = false }) {
  const key = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY
  if (!key) return <div className="rounded-2xl border bg-white p-8 text-center text-slate-600">Map configuration is unavailable.</div>
  return <div className={`${compact ? 'h-60 sm:h-72' : 'h-[420px] sm:h-[520px]'} overflow-hidden rounded-2xl border bg-white shadow-sm`}>
    <MapContainer center={[20.5937, 78.9629]} zoom={5} className="h-full w-full">
      <TileLayer attribution='&copy; OpenStreetMap contributors | Powered by <a href="https://www.geoapify.com/">Geoapify</a>' url={`https://maps.geoapify.com/v1/tile/positron/{z}/{x}/{y}.png?apiKey=${key}`} />
      <Fit properties={properties} userLocation={userLocation} />
      {userLocation && <Marker position={[userLocation.latitude, userLocation.longitude]} icon={userIcon}><Popup>Your current location</Popup></Marker>}
      {properties.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map(property => <Marker key={property.id} position={[property.latitude, property.longitude]} icon={hostelIcon}><Popup><div className="min-w-44"><strong>{property.name}</strong><br/><span>{property.city}</span>{property.lowestRent != null && <><br/><span>From {formatCurrency(property.lowestRent)}/month</span></>}<div className="mt-2 flex gap-2"><Link href={propertyPublicPath(property)} className="font-semibold text-blue-700">View</Link><a href={`https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`} target="_blank" rel="noreferrer" className="font-semibold text-green-700">Directions</a></div></div></Popup></Marker>)}
    </MapContainer>
  </div>
}
