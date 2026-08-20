import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { supabase, uploadImage } from '../../lib/supabase'
import { cleanPhoneNumber } from '../../lib/utils'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout'
import LocationPicker from '../../components/maps/LocationPicker'

const amenitiesList = [
  'WiFi', 'AC', 'Parking', 'Food', 'Gym', 'Laundry',
  'Security', 'Study Room', 'TV', 'Water Filter', 'Geyser',
  'Bed', 'Study Table', 'Attached Bathroom',
]

const roomDefaults = { room_number: '', sharing_type: 'double', capacity: 2, monthly_rent: 10000 }

export default function RegisterProperty() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [step, setStep] = useState(1)
  const [propertyImages, setPropertyImages] = useState([])
  const [location, setLocation] = useState(null)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    city: '',
    locality: '',
    pincode: '',
    propertyType: 'boys',
    contactPhone: '',
    ownerUpiId: '',
    amenities: [],
  })
  const [rooms, setRooms] = useState([{ ...roomDefaults }])

  useEffect(() => {
    const checkOwner = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login?next=/owner/register-property')
        return
      }
      const { data: user, error: userError } = await supabase.from('users').select('role,is_active,phone').eq('id', session.user.id).single()
      if (userError || user?.role !== 'owner' || !user.is_active) {
        toast.error('Active owner access required')
        router.push('/login')
        return
      }
      setFormData(current => ({ ...current, contactPhone: user.phone || '' }))
      setCheckingAuth(false)
    }
    checkOwner()
  }, [router])

  const handleChange = event => {
    setError('')
    setFormData({ ...formData, [event.target.name]: event.target.value })
  }

  const toggleAmenity = amenity => {
    setError('')
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(item => item !== amenity)
        : [...prev.amenities, amenity],
    }))
  }

  const updateRoom = (index, field, value) => {
    setError('')
    setRooms(current => current.map((room, roomIndex) => roomIndex === index ? { ...room, [field]: value } : room))
  }

  const addRoomRow = () => setRooms(current => [...current, { ...roomDefaults }])
  const removeRoomRow = index => setRooms(current => current.length === 1 ? current : current.filter((_, roomIndex) => roomIndex !== index))

  const handleImageUpload = async event => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setUploadingImages(true)
    try {
      const uploadedUrls = []
      for (const file of files) {
        const url = await uploadImage(file, 'temp-property')
        uploadedUrls.push(url)
      }
      setPropertyImages(current => [...current, ...uploadedUrls])
      toast.success(`${uploadedUrls.length} image(s) uploaded`)
    } catch (uploadError) {
      if (process.env.NODE_ENV !== 'production') console.error('Upload error:', uploadError)
      toast.error('Failed to upload images')
    } finally {
      setUploadingImages(false)
    }
  }

  const removeImage = index => setPropertyImages(current => current.filter((_, imageIndex) => imageIndex !== index))

  const validate = () => {
    if (!formData.name.trim() || !formData.address.trim() || !formData.city.trim()) return 'Please enter property name, address, and city.'
    const cleanPhone = cleanPhoneNumber(formData.contactPhone)
    if (cleanPhone && cleanPhone.length !== 10) return 'Please enter a valid 10-digit contact phone number.'
    if (!location?.latitude || !location?.longitude) return 'Please select the exact property location on the map.'
    if (!rooms.length) return 'Please add at least one room.'
    const roomNumbers = rooms.map(room => String(room.room_number || '').trim().toLowerCase())
    if (roomNumbers.some(Boolean) && new Set(roomNumbers).size !== roomNumbers.length) return 'Room numbers must be unique for this property.'
    if (rooms.some(room => !String(room.room_number || '').trim() || Number(room.capacity) < 1 || Number(room.monthly_rent) < 0)) {
      return 'Please enter valid room number, capacity, and rent for every room.'
    }
    return ''
  }

  const handleSubmit = async () => {
    if (loading) return
    setError('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      toast.error(validationError)
      if (validationError.includes('location')) setStep(1)
      return
    }

    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Please log in again.')
      const response = await fetchWithTimeout('/api/owner/add-property', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_name: formData.name,
          description: formData.description,
          address: formData.address,
          city: formData.city,
          locality: formData.locality,
          pincode: formData.pincode,
          property_type: formData.propertyType,
          contact_number: cleanPhoneNumber(formData.contactPhone),
          owner_upi_id: formData.ownerUpiId,
          amenities: formData.amenities,
          photos: propertyImages,
          location,
          rooms: rooms.map(room => ({
            room_number: String(room.room_number || '').trim(),
            sharing_type: room.sharing_type,
            capacity: Number(room.capacity),
            monthly_rent: Number(room.monthly_rent),
          })),
        }),
      }, 30000)
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = result.error || 'Property could not be added. Please try again.'
        setError(message)
        toast.error(message)
        return
      }
      localStorage.setItem('ownerPropertyId', result.propertyId)
      toast.success('Property added successfully.')
      router.push('/owner/dashboard')
    } catch (submitError) {
      if (process.env.NODE_ENV !== 'production') console.error('Add property failed:', submitError)
      const message = submitError.message || 'Property service is unavailable. Please try again.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center text-slate-600">Checking owner access...</div>

  return (
    <div className="min-h-screen py-12 bg-gradient-to-br from-slate-50 to-white">
      <div className="container mx-auto max-w-4xl px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-6">
            <h1 className="text-2xl font-bold text-white">Add New Property</h1>
            <p className="text-slate-300 text-sm mt-1">Create another property under your existing owner account.</p>
          </div>

          <div className="p-8">
            <div className="flex justify-between mb-8">
              {[1, 2, 3, 4].map(s => (
                <div key={s} className="flex-1 text-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto transition-all ${step >= s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-gray-400'}`}>{s}</div>
                  <p className="text-xs mt-2 text-slate-500">{s === 1 ? 'Property' : s === 2 ? 'Rooms' : s === 3 ? 'Photos' : 'Review'}</p>
                </div>
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <input name="name" value={formData.name} placeholder="Property Name *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                <textarea name="description" value={formData.description} placeholder="Property Description" rows="3" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                <input name="address" value={formData.address} placeholder="Full Address *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input name="city" value={formData.city} placeholder="City *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                  <input name="locality" value={formData.locality} placeholder="Locality" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                  <input name="pincode" value={formData.pincode} placeholder="Pincode" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                  <input name="contactPhone" value={formData.contactPhone} placeholder="Contact Phone" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                </div>
                <select name="propertyType" value={formData.propertyType} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange}>
                  <option value="boys">Boys PG</option>
                  <option value="girls">Girls PG</option>
                  <option value="co-ed">Co-ed PG</option>
                  <option value="professionals">Working Professionals</option>
                </select>
                <input name="ownerUpiId" value={formData.ownerUpiId} placeholder="UPI ID for payments" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                <LocationPicker value={location} onChange={next => { setLocation(next); setFormData(current => ({ ...current, address: next.formatted_address || current.address, city: next.city || current.city, pincode: next.pincode || current.pincode })) }} />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                {rooms.map((room, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-semibold text-slate-800">Room {index + 1}</p>
                      {rooms.length > 1 && <button onClick={() => removeRoomRow(index)} className="text-sm font-semibold text-red-600">Remove</button>}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <input value={room.room_number} onChange={event => updateRoom(index, 'room_number', event.target.value)} placeholder="Room number *" className="rounded-xl border border-slate-200 px-4 py-3" />
                      <select value={room.sharing_type} onChange={event => updateRoom(index, 'sharing_type', event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3">
                        <option value="single">Single</option>
                        <option value="double">Double</option>
                        <option value="triple">Triple</option>
                        <option value="four">Four</option>
                        <option value="five">Five</option>
                        <option value="custom">Custom</option>
                      </select>
                      <input type="number" min="1" value={room.capacity} onChange={event => updateRoom(index, 'capacity', event.target.value)} placeholder="Capacity *" className="rounded-xl border border-slate-200 px-4 py-3" />
                      <input type="number" min="0" value={room.monthly_rent} onChange={event => updateRoom(index, 'monthly_rent', event.target.value)} placeholder="Monthly rent *" className="rounded-xl border border-slate-200 px-4 py-3" />
                    </div>
                  </div>
                ))}
                <button onClick={addRoomRow} className="rounded-xl border-2 border-orange-300 px-4 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">+ Add another room</button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-gray-700 mb-3">Select Amenities</label>
                  <div className="grid grid-cols-2 gap-3">
                    {amenitiesList.map(amenity => (
                      <button key={amenity} type="button" onClick={() => toggleAmenity(amenity)} className={`p-3 rounded-xl border-2 transition-all ${formData.amenities.includes(amenity) ? 'border-slate-800 bg-slate-50 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        {amenity}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-gray-700 mb-3">Upload Property Photos</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {propertyImages.map((img, index) => (
                      <div key={img} className="relative group">
                        <img src={img} alt={`Property ${index + 1}`} className="w-full h-24 object-cover rounded-lg" />
                        <button onClick={() => removeImage(index)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition">x</button>
                      </div>
                    ))}
                    <label className="border-2 border-dashed border-gray-300 rounded-lg h-24 flex items-center justify-center cursor-pointer hover:border-slate-400 transition">
                      <div className="text-center"><div className="text-2xl mb-1">+</div><div className="text-xs text-gray-400">Add Photo</div></div>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={uploadingImages} />
                    </label>
                  </div>
                  {uploadingImages && <div className="text-center text-slate-600 text-sm mt-2">Uploading...</div>}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="bg-slate-50 rounded-xl p-6">
                <p className="text-slate-800 text-lg mb-4 text-center font-semibold">Review New Property</p>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div><p className="text-slate-500">Property Name:</p><p className="font-semibold text-slate-700">{formData.name || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">City:</p><p className="font-semibold text-slate-700">{formData.city || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Rooms:</p><p className="font-semibold text-slate-700">{rooms.length}</p></div>
                  <div><p className="text-slate-500">Amenities:</p><p className="font-semibold text-slate-700">{formData.amenities.length} selected</p></div>
                  <div><p className="text-slate-500">Membership:</p><p className="font-semibold text-slate-700">Inactive until requested/approved for this property</p></div>
                  <div><p className="text-slate-500">Photos:</p><p className="font-semibold text-slate-700">{propertyImages.length} image(s)</p></div>
                  <div className="md:col-span-2"><p className="text-slate-500">Map location:</p><p className="font-semibold text-slate-700">{location?.formatted_address || 'Not selected'}</p></div>
                </div>
              </div>
            )}

            {error && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

            <div className="flex gap-4 mt-8">
              {step > 1 && <button onClick={() => setStep(step - 1)} className="flex-1 border-2 border-slate-300 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-50 transition">Back</button>}
              {step < 4 ? (
                <button onClick={() => setStep(step + 1)} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 transition">Continue</button>
              ) : (
                <button onClick={handleSubmit} disabled={loading || uploadingImages} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 disabled:opacity-50 transition">
                  {loading ? 'Adding...' : 'Add Property'}
                </button>
              )}
            </div>

            <div className="mt-6 text-center">
              <Link href="/owner/dashboard" className="text-slate-600 hover:text-slate-800 text-sm">Back to owner dashboard</Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
