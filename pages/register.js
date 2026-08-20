import { useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { uploadImage } from '../lib/supabase'
import { cleanPhoneNumber } from '../lib/utils'
import toast from 'react-hot-toast'
import LocationPicker from '../components/maps/LocationPicker'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'

const DUPLICATE_ACCOUNT_MESSAGE = 'An owner account already exists with these details. Please login to add another property.'

function getRegistrationFailure(response, result = {}) {
  const apiMessage = typeof result.error === 'string' ? result.error : ''
  const isDuplicate = response.status === 409 || /already|exists|duplicate|registered/i.test(apiMessage)
  if (isDuplicate) return { message: DUPLICATE_ACCOUNT_MESSAGE, duplicate: true }
  if (response.status === 400) return { message: apiMessage || 'Please check the registration details and try again.', duplicate: false }
  if (response.status === 503) return { message: 'Registration service is temporarily unavailable. Please try again in a few minutes.', duplicate: false }
  if (response.status >= 500) return { message: 'Registration could not be completed right now. Please try again.', duplicate: false }
  return { message: apiMessage || 'Registration failed. Please try again.', duplicate: false }
}

export default function Register() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [registrationError, setRegistrationError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [step, setStep] = useState(1)
  const [propertyImages, setPropertyImages] = useState([])
  const [location, setLocation] = useState(null)
  const [policyConsent, setPolicyConsent] = useState(false)
  const [policyConsentError, setPolicyConsentError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    address: '',
    city: '',
    pincode: '',
    propertyType: 'boys',
    totalRooms: '',
    description: '',
    amenities: []
  })

  const amenitiesList = [
    'WiFi', 'AC', 'Parking', 'Food', 'Gym', 'Laundry',
    'Security', 'Study Room', 'TV', 'Water Filter', 'Geyser',
    'Bed', 'Study Table', 'Attached Bathroom'
  ]

  const fieldRefs = useRef({})
  const registerFieldRef = name => node => {
    if (node) fieldRefs.current[name] = node
  }

  const setFirstErrorFocus = errors => {
    const firstField = Object.keys(errors)[0]
    if (firstField && fieldRefs.current[firstField]) {
      window.setTimeout(() => fieldRefs.current[firstField]?.focus(), 0)
    }
  }

  const passwordError = value => {
    if (!value || value.length < 8) return 'Password must be at least 8 characters'
    if (!/[A-Za-z]/.test(value)) return 'Password must include at least one letter'
    if (!/\d/.test(value)) return 'Password must include at least one number'
    return ''
  }

  const validateStep = (targetStep = step) => {
    const errors = {}
    if (targetStep === 1) {
      if (!formData.name.trim()) errors.name = 'Property name is required'
      if (!formData.address.trim()) errors.address = 'Full address is required'
      if (!formData.city.trim()) errors.city = 'City is required'
      if (formData.pincode && !/^\d{6}$/.test(formData.pincode.trim())) errors.pincode = 'Enter a valid 6-digit pincode'
      if (!formData.propertyType) errors.propertyType = 'Select a property type'
      if (!Number.isFinite(Number(formData.totalRooms)) || Number(formData.totalRooms) <= 0) errors.totalRooms = 'Enter a valid room count'
      if (!location?.latitude || !location?.longitude) errors.location = 'Select the exact property location on the map'
    }
    if (targetStep === 2) {
      const cleanPhone = cleanPhoneNumber(formData.phone)
      const pwError = passwordError(formData.password)
      if (!formData.ownerName.trim()) errors.ownerName = 'Owner name is required'
      if (cleanPhone.length !== 10) errors.phone = 'Enter a valid 10-digit phone number'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) errors.email = 'Enter a valid email address'
      if (pwError) errors.password = pwError
      if (formData.password !== formData.confirmPassword) errors.confirmPassword = 'Passwords do not match'
    }
    if (targetStep === 3 && formData.amenities.length === 0) errors.amenities = 'Select at least one amenity'
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      setFirstErrorFocus(errors)
      toast.error('Please fix the highlighted fields')
      return false
    }
    return true
  }

  const continueToNextStep = () => {
    if (validateStep(step)) setStep(step + 1)
  }

  const handleChange = (e) => {
    setRegistrationError(null)
    setFieldErrors(current => ({ ...current, [e.target.name]: '' }))
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const toggleAmenity = (amenity) => {
    setRegistrationError(null)
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity]
    }))
  }

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    setUploadingImages(true)
    try {
      const uploadedUrls = []
      for (const file of files) {
        const url = await uploadImage(file, 'temp-property')
        uploadedUrls.push(url)
      }
      setPropertyImages([...propertyImages, ...uploadedUrls])
      toast.success(`${uploadedUrls.length} image(s) uploaded`)
    } catch (error) {
      console.error('Upload error:', error)
      toast.error('Failed to upload images')
    } finally {
      setUploadingImages(false)
    }
  }

  const removeImage = (index) => {
    const newImages = [...propertyImages]
    newImages.splice(index, 1)
    setPropertyImages(newImages)
    toast.success('Image removed')
  }

  const handleSubmit = async () => {
    if (loading) return
    setRegistrationError(null)
    if (![1, 2, 3, 4].every(validateStep)) return
    if (!policyConsent) {
      setPolicyConsentError('You must agree to the Privacy Policy and Terms & Conditions before registering.')
      return
    }
    setPolicyConsentError('')
    // Validate password
    const pwError = passwordError(formData.password)
    if (pwError) {
      toast.error(pwError)
      return
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (!location?.latitude || !location?.longitude) {
      toast.error('Please select the exact property location on the map')
      setStep(1)
      return
    }

    setLoading(true)
    try {
      const cleanPhone = cleanPhoneNumber(formData.phone)
      if (cleanPhone.length !== 10) {
        toast.error('Invalid phone number')
        setLoading(false)
        return
      }

      const response = await fetchWithTimeout('/api/register-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          phone: cleanPhone,
          full_name: formData.ownerName,
          property_name: formData.name,
          description: formData.description,
          address: formData.address,
          city: formData.city,
          pincode: formData.pincode,
          property_type: formData.propertyType,
          amenities: formData.amenities,
          photos: propertyImages,
          location,
        }),
      }, 30000)

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        const failure = getRegistrationFailure(response, result)
        setRegistrationError(failure)
        if (failure.duplicate) setStep(2)
        toast.error(failure.message)
        return
      }

      toast.success('Property registered successfully! Please login.')
      router.push('/login')
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('Registration request failed:', error)
      const message = error.name === 'AbortError' ? 'Registration request timed out. Please try again.' : 'Registration service is unavailable. Please try again.'
      setRegistrationError({ message, duplicate: false })
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen py-12 bg-gradient-to-br from-slate-50 to-white">
      <div className="container mx-auto max-w-3xl px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-8 py-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">Register Your Property</h1>
                <p className="text-slate-300 text-sm mt-1">Create your owner account and submit your property details.</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="flex justify-between mb-8">
              {[1, 2, 3, 4, 5].map(s => (
                <div key={s} className="flex-1 text-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto transition-all ${step >= s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-gray-400'}`}>{s}</div>
                  <p className="text-xs mt-2 text-slate-500">{s === 1 ? 'Property' : s === 2 ? 'Owner' : s === 3 ? 'Amenities' : s === 4 ? 'Photos' : 'Submit'}</p>
                </div>
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <input ref={registerFieldRef('name')} name="name" value={formData.name} placeholder="Property Name *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.name)} required />
                {fieldErrors.name && <p className="text-xs font-medium text-red-600">{fieldErrors.name}</p>}
                <textarea name="description" value={formData.description} placeholder="Property Description" rows="3" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} />
                <input ref={registerFieldRef('address')} name="address" value={formData.address} placeholder="Full Address *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.address)} required />
                {fieldErrors.address && <p className="text-xs font-medium text-red-600">{fieldErrors.address}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <input ref={registerFieldRef('city')} name="city" value={formData.city} placeholder="City *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.city)} required />
                    {fieldErrors.city && <p className="text-xs font-medium text-red-600">{fieldErrors.city}</p>}
                  </div>
                  <div>
                    <input ref={registerFieldRef('pincode')} name="pincode" value={formData.pincode} placeholder="Pincode" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.pincode)} />
                    {fieldErrors.pincode && <p className="text-xs font-medium text-red-600">{fieldErrors.pincode}</p>}
                  </div>
                </div>
                <select ref={registerFieldRef('propertyType')} name="propertyType" value={formData.propertyType} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.propertyType)}>
                  <option value="boys">Boys PG</option>
                  <option value="girls">Girls PG</option>
                  <option value="co-ed">Co-ed PG</option>
                </select>
                {fieldErrors.propertyType && <p className="text-xs font-medium text-red-600">{fieldErrors.propertyType}</p>}
                <input ref={registerFieldRef('totalRooms')} name="totalRooms" value={formData.totalRooms} type="number" min="1" placeholder="Total Rooms *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.totalRooms)} required />
                {fieldErrors.totalRooms && <p className="text-xs font-medium text-red-600">{fieldErrors.totalRooms}</p>}
                <LocationPicker value={location} onChange={next => { setLocation(next); setFormData(current => ({ ...current, address: next.formatted_address || current.address, city: next.city || current.city, pincode: next.pincode || current.pincode })) }} />
                {fieldErrors.location && <p className="text-xs font-medium text-red-600">{fieldErrors.location}</p>}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <input ref={registerFieldRef('ownerName')} name="ownerName" value={formData.ownerName} placeholder="Owner Name *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.ownerName)} required />
                {fieldErrors.ownerName && <p className="text-xs font-medium text-red-600">{fieldErrors.ownerName}</p>}
                <div className="flex gap-2">
                  <span className="bg-slate-50 px-4 py-3 rounded-xl border border-slate-200">+91</span>
                  <input ref={registerFieldRef('phone')} name="phone" value={formData.phone} placeholder="Phone Number *" className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.phone)} required />
                </div>
                {fieldErrors.phone && <p className="text-xs font-medium text-red-600">{fieldErrors.phone}</p>}
                <input ref={registerFieldRef('email')} name="email" value={formData.email} type="email" placeholder="Email *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.email)} required />
                {fieldErrors.email && <p className="text-xs font-medium text-red-600">{fieldErrors.email}</p>}
                <input ref={registerFieldRef('password')} name="password" value={formData.password} type="password" placeholder="Password *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.password)} required />
                <p className="text-xs text-slate-500">Use at least 8 characters with one letter and one number.</p>
                {fieldErrors.password && <p className="text-xs font-medium text-red-600">{fieldErrors.password}</p>}
                <input ref={registerFieldRef('confirmPassword')} name="confirmPassword" value={formData.confirmPassword} type="password" placeholder="Confirm Password *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-800" onChange={handleChange} aria-invalid={Boolean(fieldErrors.confirmPassword)} required />
                {fieldErrors.confirmPassword && <p className="text-xs font-medium text-red-600">{fieldErrors.confirmPassword}</p>}
              </div>
            )}

            {step === 3 && (
              <div>
                <label className="block text-gray-700 mb-3">Select Amenities</label>
                <div className="grid grid-cols-2 gap-3">
                  {amenitiesList.map(amenity => (
                    <button key={amenity} type="button" onClick={() => toggleAmenity(amenity)} className={`p-3 rounded-xl border-2 transition-all ${formData.amenities.includes(amenity) ? 'border-slate-800 bg-slate-50 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {amenity}
                    </button>
                  ))}
                </div>
                {fieldErrors.amenities && <p className="mt-3 text-xs font-medium text-red-600">{fieldErrors.amenities}</p>}
              </div>
            )}

            {step === 4 && (
              <div>
                <label className="block text-gray-700 mb-3">Upload Property Photos</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {propertyImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img} alt={`Property ${i + 1}`} className="w-full h-24 object-cover rounded-lg" />
                      <button onClick={() => removeImage(i)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-sm opacity-0 group-hover:opacity-100 transition">✕</button>
                    </div>
                  ))}
                  <label className="border-2 border-dashed border-gray-300 rounded-lg h-24 flex items-center justify-center cursor-pointer hover:border-slate-400 transition">
                    <div className="text-center">
                      <div className="text-2xl mb-1">📷</div>
                      <div className="text-xs text-gray-400">Add Photo</div>
                    </div>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={uploadingImages} />
                  </label>
                </div>
                {uploadingImages && <div className="text-center text-slate-600 text-sm mt-2">Uploading...</div>}
                <p className="text-xs text-gray-400 mt-2">Upload photos of rooms, amenities, and property exterior</p>
              </div>
            )}

            {step === 5 && (
              <div className="bg-slate-50 rounded-xl p-6">
                <p className="text-slate-800 text-lg mb-4 text-center font-semibold">✨ Review Your Details</p>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div><p className="text-slate-500">Property Name:</p><p className="font-semibold text-slate-700">{formData.name || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Location:</p><p className="font-semibold text-slate-700">{formData.city || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Property Type:</p><p className="font-semibold text-slate-700">{formData.propertyType}</p></div>
                  <div><p className="text-slate-500">Total Rooms:</p><p className="font-semibold text-slate-700">{formData.totalRooms || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Amenities:</p><p className="font-semibold text-slate-700">{formData.amenities.length} selected</p></div>
                  <div><p className="text-slate-500">Owner:</p><p className="font-semibold text-slate-700">{formData.ownerName || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Phone:</p><p className="font-semibold text-slate-700">{formData.phone || 'Not entered'}</p></div>
                  <div><p className="text-slate-500">Email:</p><p className="font-semibold text-slate-700">{formData.email || 'Not entered'}</p></div>
                  <div className="md:col-span-2"><p className="text-slate-500">Photos:</p><p className="font-semibold text-slate-700">{propertyImages.length} image(s) uploaded</p></div>
                  <div className="md:col-span-2"><p className="text-slate-500">Map location:</p><p className="font-semibold text-slate-700">{location?.formatted_address || 'Not selected'}</p></div>
                </div>
                <p className="text-gray-400 text-sm text-center mt-4">Click Complete Registration to finish</p>
              </div>
            )}

            {registrationError && (
              <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700">{registrationError.message}</p>
                {registrationError.duplicate && (
                  <Link href="/login/owner?next=/owner/register-property" className="mt-3 inline-flex rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                    Owner Login to add property
                  </Link>
                )}
              </div>
            )}

            {step === 5 && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-2"><input type="checkbox" id="ownerPolicyConsent" checked={policyConsent} onChange={event => { setPolicyConsent(event.target.checked); if (event.target.checked) setPolicyConsentError('') }} className="mt-1" /><label htmlFor="ownerPolicyConsent" className="text-sm text-slate-700">I have read and agree to HostelSet’s <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Privacy Policy</Link> and <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Terms &amp; Conditions</Link>.</label></div>
              {policyConsentError && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{policyConsentError}</p>}
            </div>}

            <div className="flex gap-4 mt-8">
              {step > 1 && (
                <button onClick={() => setStep(step - 1)} className="flex-1 border-2 border-slate-300 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-50 transition">← Back</button>
              )}
              {step < 5 ? (
                <button onClick={continueToNextStep} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 transition">Continue →</button>
              ) : (
                <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 disabled:opacity-50 transition">
                  {loading ? 'Registering property...' : 'Complete Property Registration →'}
                </button>
              )}
            </div>

            <div className="mt-6 text-center">
              <Link href="/login/owner" className="text-slate-600 hover:text-slate-800 text-sm">Already have an owner account? Owner Login</Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
