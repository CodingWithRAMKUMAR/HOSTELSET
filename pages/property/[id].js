import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { publicSupabase as supabase } from '../../lib/publicSupabase'
import { formatCurrency, getSharingDetails, getPropertyTypeLabel, cleanPhoneNumber, formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'
import { usePublicRealtimeRefresh as useRealtimeRefresh } from '../../hooks/usePublicRealtimeRefresh'
import BrandLogo from '../../components/BrandLogo'
import Head from 'next/head'
import Image from 'next/image'
import PublicFooter from '../../components/PublicFooter'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout'
import { propertyPublicPath, UUID_PATTERN } from '../../lib/propertySlug'
import { BLOOD_GROUPS } from '../../lib/bloodGroups'
import {
  DEFAULT_APPLICATION_DEPOSIT,
  SITE_URL,
  buildReservationCounts,
  buildVacateInfo,
  fetchPublicPropertyRooms,
  normalizeProperty,
  settingsFor,
} from '../../products/hostels/public/detail'

const NearbyHostelMap = dynamic(
  () => import('../../components/maps/NearbyHostelMap'),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500">
        Loading map…
      </div>
    ),
  }
)

export default function PropertyDetail({ initialProperty = null, initialRooms = [], initialSettings = null, similarProperties = [] }) {
  const router = useRouter()
  const { id } = router.query
  const [property, setProperty] = useState(() => normalizeProperty(initialProperty))
  const [rooms, setRooms] = useState(initialRooms)
  const [loading, setLoading] = useState(!initialProperty)
  const [loadError, setLoadError] = useState('')
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [applyForm, setApplyForm] = useState({ name: '', phone: '', email: '', bloodGroup: '', message: '' })
  const [idProof, setIdProof] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [activeTab, setActiveTab] = useState('rooms')
  const [ownerSettings, setOwnerSettings] = useState(() => settingsFor(initialProperty, initialSettings))
  const [applySubmitting, setApplySubmitting] = useState(false)

  // Regular payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentScreenshot, setPaymentScreenshot] = useState(null)
  const [transactionId, setTransactionId] = useState('')
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentProgress, setPaymentProgress] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')
  const copyFeedbackTimerRef = useRef(null)
  const [applicationConsent, setApplicationConsent] = useState(false)
  const [applicationConsentError, setApplicationConsentError] = useState('')

  // Pre‑booking state
  const [vacateInfo, setVacateInfo] = useState(() => buildVacateInfo(initialRooms))
  const [showPrebookModal, setShowPrebookModal] = useState(false)
  const [prebookRoomId, setPrebookRoomId] = useState(null)
  const [prebookForm, setPrebookForm] = useState({ name: '', phone: '', email: '', move_in_date: '', message: '' })
  const [prebookIdProof, setPrebookIdProof] = useState(null)
  const [prebookPhoto, setPrebookPhoto] = useState(null)
  const [prebookPhotoPreview, setPrebookPhotoPreview] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [prebookPolicyConsent, setPrebookPolicyConsent] = useState(false)
  const [prebookConsentError, setPrebookConsentError] = useState('')
  const [prebookSubmitting, setPrebookSubmitting] = useState(false)

  // Pre‑booking payment modal
  const [showPrebookPaymentModal, setShowPrebookPaymentModal] = useState(false)
  const [prebookPaymentScreenshot, setPrebookPaymentScreenshot] = useState(null)
  const [prebookTransactionId, setPrebookTransactionId] = useState('')
  const [prebookPaymentSubmitting, setPrebookPaymentSubmitting] = useState(false)
  const [prebookPaymentProgress, setPrebookPaymentProgress] = useState('')

  // Apply form validation
  const [phoneError, setPhoneError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [phoneValid, setPhoneValid] = useState(false)
  const [emailValid, setEmailValid] = useState(false)
  const [checkingPhone, setCheckingPhone] = useState(false)
  const [checkingEmail, setCheckingEmail] = useState(false)

  // Pre‑booking form validation (same as apply)
  const [prebookPhoneError, setPrebookPhoneError] = useState('')
  const [prebookEmailError, setPrebookEmailError] = useState('')
  const [prebookPhoneValid, setPrebookPhoneValid] = useState(false)
  const [prebookEmailValid, setPrebookEmailValid] = useState(false)
  const [prebookCheckingPhone, setPrebookCheckingPhone] = useState(false)
  const [prebookCheckingEmail, setPrebookCheckingEmail] = useState(false)

  // Public-safe active reservation counts are derived by the public rooms RPC.
  const [reservationCounts, setReservationCounts] = useState(() => buildReservationCounts(initialRooms))
  const redirectTimerRef = useRef(null)
  const resolvedPropertyId = property?.id || (UUID_PATTERN.test(String(id || '')) ? id : null)

  useEffect(() => () => { clearTimeout(redirectTimerRef.current); clearTimeout(copyFeedbackTimerRef.current) }, [])
  useEffect(() => {
    if (!photo) { setPhotoPreview(''); return undefined }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])
  useEffect(() => {
    if (!prebookPhoto) { setPrebookPhotoPreview(''); return undefined }
    const url = URL.createObjectURL(prebookPhoto)
    setPrebookPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [prebookPhoto])

  const copyPaymentDestination = async (value, message) => {
    if (!value) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else {
        const input = document.createElement('textarea'); input.value = value; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select()
        try { if (!document.execCommand('copy')) throw new Error('Copy unavailable') }
        finally { document.body.removeChild(input) }
      }
      setCopyFeedback(message); clearTimeout(copyFeedbackTimerRef.current); copyFeedbackTimerRef.current = setTimeout(() => setCopyFeedback(''), 2200)
    } catch { setCopyFeedback('Copy failed. Select and copy the value manually.') }
  }

  useEffect(() => {
    if (!id) return

    if (initialProperty && (initialProperty.id === id || initialProperty.slug === id)) {
      const normalizedProperty = normalizeProperty(initialProperty)
      setProperty(normalizedProperty)
      setRooms(initialRooms)
      setOwnerSettings(settingsFor(normalizedProperty, initialSettings))
      setVacateInfo(buildVacateInfo(initialRooms))
      setReservationCounts(buildReservationCounts(initialRooms))
      setLoadError('')
      setLoading(false)

      // Refresh cached ISR values immediately from Supabase.
      loadData(true)
      return
    }

    loadData()
  }, [id, initialProperty?.id])

  const loadData = async (background = false) => {
    if (!background) setLoading(true)
    if (!background) setLoadError('')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const identifier = String(id || '').trim()

      if (!identifier) {
        throw new Error('A property identifier is required.')
      }

      const response = await fetch(
        `/api/public/properties/${encodeURIComponent(identifier)}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      )

      const contentType = String(
        response.headers.get('content-type') || ''
      ).toLowerCase()

      if (!contentType.includes('application/json')) {
        await response.text().catch(() => '')

        throw new Error(
          'The property service returned an invalid response.'
        )
      }

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            'This property is currently unavailable for public applications.'
        )
      }

      if (!payload?.property || !Array.isArray(payload?.rooms)) {
        throw new Error(
          'The property service returned incomplete information.'
        )
      }

      const propertyData = payload.property
      const roomsData = payload.rooms
      const settingsData = payload.settings

      const normalizedProperty = normalizeProperty(propertyData)

      setProperty(normalizedProperty)
      setRooms(roomsData)

      if (normalizedProperty) {
        setOwnerSettings(
          settingsFor(normalizedProperty, settingsData)
        )
      }

      loadVacateInfo(roomsData)
      loadReservationCounts(roomsData)
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.error('Property details request timed out.')
      } else {
        console.error('Error loading property details:', error)
      }

      if (!background) {
        setLoadError(
          error?.name === 'AbortError'
            ? 'The property is taking too long to load. Please try again.'
            : error?.message ||
                'We could not load this property. Please check your connection and try again.'
        )
      }
    } finally {
      clearTimeout(timeoutId)

      if (!background) {
        setLoading(false)
      }
    }
  }
  const loadVacateInfo = (roomRows) => {
    setVacateInfo(buildVacateInfo(roomRows))
  }

  const loadReservationCounts = (roomRows) => {
    setReservationCounts(buildReservationCounts(roomRows))
  }

  const selectedRoomDetails = rooms.find(room => room.id === selectedRoom)

  const getRoomApplicationDeposit = () => {
    const configuredDeposit = Number(ownerSettings?.application_deposit)

    return Number.isFinite(configuredDeposit) && configuredDeposit > 0
      ? configuredDeposit
      : DEFAULT_APPLICATION_DEPOSIT
  }

  const calculateTotalAmount = () => {
    return getRoomApplicationDeposit()
  }

  const handleFileChange = (e, setter) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File must be less than 5MB')
      return
    }
    setter(file)
  }

  const fileToPayload = file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ data: reader.result, type: file.type, name: file.name })
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })

  const readApiResponse = async (response, fallbackMessage) => {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('application/json')) {
      await response.text().catch(() => '')
      throw new Error(response.ok ? fallbackMessage : `${fallbackMessage}. The server returned an invalid response; please retry.`)
    }
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object') throw new Error(fallbackMessage)
    return payload
  }

  const optimizeUploadFile = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/') || file.size < 900 * 1024) return file
    if (typeof window === 'undefined' || typeof document === 'undefined') return file

    try {
      const bitmap = await createImageBitmap(file)
      const maxDimension = 1920
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) { bitmap.close?.(); return file }
      context.drawImage(bitmap, 0, 0, width, height)
      bitmap.close?.()
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
      if (!blob || blob.size >= file.size) return file
      const baseName = String(file.name || 'upload').replace(/\.[^.]+$/, '')
      return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() })
    } catch (error) {
      console.warn('Image optimisation skipped:', error)
      return file
    }
  }

  const uploadPrivateFile = async (originalFile, category) => {
    const file = await optimizeUploadFile(originalFile)
    const response = await fetchWithTimeout('/api/visitor/upload-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId: resolvedPropertyId, category, contentType: file.type, size: file.size }),
    }, 15000)
    const signed = await readApiResponse(response, 'Could not prepare upload')
    if (!response.ok) throw new Error(signed.error || 'Could not prepare upload')
    const { error } = await supabase.storage.from('tenant-documents').uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type })
    if (error) throw error
    return signed.path
  }

  useRealtimeRefresh(`public-property-live:${id || 'waiting'}`, ['properties', 'rooms', 'owner_settings'], loadData, Boolean(id), 120)

  // ========== Secure visitor identity precheck ==========
  const checkVisitorIdentity = async ({ phone, email, kind }) => {
    if (!resolvedPropertyId) throw new Error('This property is unavailable. Please refresh and try again.')

    const response = await fetchWithTimeout('/api/visitor/check-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: resolvedPropertyId,
        kind,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      }),
    }, 10000)

    const result = await readApiResponse(response, 'Could not verify these details')
    if (!response.ok) throw new Error(result.error || 'Could not verify these details')
    return result.available === true
  }

  const validatePhone = async (phone) => {
    const cleanPhone = cleanPhoneNumber(phone)
    if (!/^\d{10}$/.test(cleanPhone)) {
      setPhoneError('Enter a valid 10-digit phone number')
      setPhoneValid(false)
      return false
    }

    setCheckingPhone(true)
    setPhoneValid(false)
    try {
      const available = await checkVisitorIdentity({ phone: cleanPhone, kind: 'application' })
      if (!available) {
        setPhoneError('This phone number is already associated with an existing account or active request. Please log in or contact the property owner.')
        return false
      }
      setPhoneError('')
      setPhoneValid(true)
      return true
    } catch (error) {
      console.error('Phone validation error:', error)
      setPhoneError(error.message || 'Could not verify this phone number. Please try again.')
      return false
    } finally {
      setCheckingPhone(false)
    }
  }

  const validateEmail = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setEmailError('Enter a valid email address')
      setEmailValid(false)
      return false
    }

    setCheckingEmail(true)
    setEmailValid(false)
    try {
      const available = await checkVisitorIdentity({ email: normalizedEmail, kind: 'application' })
      if (!available) {
        setEmailError('This email is already associated with an existing account or active request. Please log in or contact the property owner.')
        return false
      }
      setEmailError('')
      setEmailValid(true)
      return true
    } catch (error) {
      console.error('Email validation error:', error)
      setEmailError(error.message || 'Could not verify this email. Please try again.')
      return false
    } finally {
      setCheckingEmail(false)
    }
  }

  const handlePhoneBlur = async () => {
    if (applyForm.phone) await validatePhone(applyForm.phone)
    else {
      setPhoneError('Phone number is required')
      setPhoneValid(false)
    }
  }

  const handleEmailBlur = async () => {
    if (applyForm.email) await validateEmail(applyForm.email)
    else {
      setEmailError('Email is required')
      setEmailValid(false)
    }
  }

  const validatePrebookPhone = async (phone) => {
    const cleanPhone = cleanPhoneNumber(phone)
    if (!/^\d{10}$/.test(cleanPhone)) {
      setPrebookPhoneError('Enter a valid 10-digit phone number')
      setPrebookPhoneValid(false)
      return false
    }

    setPrebookCheckingPhone(true)
    setPrebookPhoneValid(false)
    try {
      const available = await checkVisitorIdentity({ phone: cleanPhone, kind: 'prebooking' })
      if (!available) {
        setPrebookPhoneError('This phone number is already associated with an existing account or active request. Please log in or contact the property owner.')
        return false
      }
      setPrebookPhoneError('')
      setPrebookPhoneValid(true)
      return true
    } catch (error) {
      console.error('Prebook phone validation error:', error)
      setPrebookPhoneError(error.message || 'Could not verify this phone number. Please try again.')
      return false
    } finally {
      setPrebookCheckingPhone(false)
    }
  }

  const validatePrebookEmail = async (email) => {
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setPrebookEmailError('Enter a valid email address')
      setPrebookEmailValid(false)
      return false
    }

    setPrebookCheckingEmail(true)
    setPrebookEmailValid(false)
    try {
      const available = await checkVisitorIdentity({ email: normalizedEmail, kind: 'prebooking' })
      if (!available) {
        setPrebookEmailError('This email is already associated with an existing account or active request. Please log in or contact the property owner.')
        return false
      }
      setPrebookEmailError('')
      setPrebookEmailValid(true)
      return true
    } catch (error) {
      console.error('Prebook email validation error:', error)
      setPrebookEmailError(error.message || 'Could not verify this email. Please try again.')
      return false
    } finally {
      setPrebookCheckingEmail(false)
    }
  }

  const handlePrebookPhoneBlur = async () => {
    if (prebookForm.phone) await validatePrebookPhone(prebookForm.phone)
    else {
      setPrebookPhoneError('Phone number is required')
      setPrebookPhoneValid(false)
    }
  }

  const handlePrebookEmailBlur = async () => {
    if (prebookForm.email) await validatePrebookEmail(prebookForm.email)
    else {
      setPrebookEmailError('Email is required')
      setPrebookEmailValid(false)
    }
  }

  // ========== Regular Application Flow ==========
  // Step 1: Validate and open payment modal (no DB insert yet)
  const submitApplication = async () => {
    if (!applicationConsent) {
      setApplicationConsentError('You must agree to the Privacy Policy and Terms & Conditions before continuing.')
      return
    }
    setApplicationConsentError('')
    if (!applyForm.name || !applyForm.phone || !applyForm.email || !applyForm.bloodGroup) {
      toast.error('Please fill all required fields, including blood group')
      return
    }
    const cleanPhone = cleanPhoneNumber(applyForm.phone)
    if (cleanPhone.length !== 10) {
      toast.error('Enter valid 10-digit phone number')
      return
    }
    if (!idProof || !photo) {
      toast.error('Please upload ID proof and photo')
      return
    }
    const phoneOk = await validatePhone(applyForm.phone)
    const emailOk = await validateEmail(applyForm.email)
    if (!phoneOk || !emailOk) {
      toast.error('Please correct the errors before submitting')
      return
    }

    // Close apply modal and open payment modal
    setShowApplyModal(false)
    setPaymentScreenshot(null)
    setTransactionId('')
    setShowPaymentModal(true)
  }

  // Step 2: After payment proof, insert application and tenant
  const submitPayment = async () => {
    if (paymentSubmitting) return
    setPaymentProgress('Validating payment details...')
    if (!paymentScreenshot) {
      toast.error('Please upload payment screenshot')
      return
    }
    if (!transactionId.trim()) {
      toast.error('Enter the UPI transaction/reference ID')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(paymentScreenshot.type)) {
      toast.error('Use a JPEG, PNG, WEBP, or PDF file')
      setPaymentScreenshot(null)
      return
    }
    if (!ownerSettings.upi_id) {
      toast.error('Owner payment details are not configured yet.')
      return
    }
    setPaymentSubmitting(true)
    try {
      setPaymentProgress('Uploading documents...')
      const [idPayload, photoPayload, paymentPayload] = await Promise.all([
        uploadPrivateFile(idProof, 'identity'), uploadPrivateFile(photo, 'photos'), uploadPrivateFile(paymentScreenshot, 'payments'),
      ])
      setPaymentProgress('Submitting application and sending invite...')
      const response = await fetchWithTimeout('/api/visitor/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'application', propertyId: resolvedPropertyId, roomId: selectedRoom, form: applyForm,
          files: { idProof: idPayload, photo: photoPayload, payment: paymentPayload }, transactionId,
        }),
      }, 30000)
      const result = await readApiResponse(response, 'Application submission failed')
      if (!response.ok) throw new Error(result.error || 'Submission failed')
      toast.success('Application submitted. You will receive a password setup email after approval.', { duration: 8000 })
      setShowPaymentModal(false)
      setApplyForm({ name: '', phone: '', email: '', message: '' })
      setApplicationConsent(false); setApplicationConsentError('')
      setIdProof(null); setPhoto(null); setPaymentScreenshot(null); setTransactionId('')
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = setTimeout(() => router.push('/login'), 8000)
    } catch (error) {
      toast.error(error.message || 'Application submission failed')
    } finally {
      setPaymentSubmitting(false)
      setPaymentProgress('')
    }
  }

  // ========== PRE‑BOOKING FLOW (unchanged) ==========
  const openPrebookModal = (roomId, vacateDate) => {
    const today = new Date().toISOString().split('T')[0]
    setPrebookRoomId(roomId)
    setPrebookForm({
      name: '',
      phone: '',
      email: '',
      move_in_date: vacateDate && vacateDate > today ? vacateDate : today,
      message: ''
    })
    setPrebookIdProof(null)
    setPrebookPhoto(null)
    setAgreeTerms(false)
    setPrebookPolicyConsent(false); setPrebookConsentError('')
    setPrebookPhoneError('')
    setPrebookEmailError('')
    setPrebookPhoneValid(false)
    setPrebookEmailValid(false)
    setShowPrebookModal(true)
  }

  const submitPreBookingForm = async () => {
    if (!prebookForm.name || !prebookForm.phone || !prebookForm.email || !prebookForm.move_in_date) {
      toast.error('Please fill all required fields (Name, Phone, Email, Expected Move‑in Date)')
      return
    }
    const cleanPhone = cleanPhoneNumber(prebookForm.phone)
    if (cleanPhone.length !== 10) {
      toast.error('Enter valid 10-digit phone number')
      return
    }
    if (!prebookForm.email.includes('@')) {
      toast.error('Enter a valid email address')
      return
    }
    if (!prebookIdProof || !prebookPhoto) {
      toast.error('Please upload ID proof and passport photo')
      return
    }
    if (!agreeTerms) {
      toast.error('You must agree to the terms & conditions')
      return
    }
    if (!prebookPolicyConsent) {
      setPrebookConsentError('You must agree to the Privacy Policy and Terms & Conditions before continuing.')
      return
    }
    setPrebookConsentError('')
    if (!prebookRoomId) {
      toast.error('Room not selected')
      return
    }
    const phoneOk = await validatePrebookPhone(prebookForm.phone)
    const emailOk = await validatePrebookEmail(prebookForm.email)
    if (!phoneOk || !emailOk) {
      toast.error('Please correct the errors before proceeding')
      return
    }
    setShowPrebookModal(false)
    setShowPrebookPaymentModal(true)
  }

  const submitPreBookingPayment = async () => {
    if (prebookPaymentSubmitting) return
    setPrebookPaymentProgress('Validating payment details...')
    if (!prebookPaymentScreenshot) {
      toast.error('Please upload payment screenshot')
      return
    }
    const cleanPhone = cleanPhoneNumber(prebookForm.phone)
    if (!ownerSettings.upi_id) {
      toast.error('Owner payment details are not configured yet.')
      return
    }
    if (!prebookTransactionId.trim()) {
      toast.error('Enter the UPI transaction/reference ID')
      return
    }
    setPrebookPaymentSubmitting(true)
    try {
      setPrebookPaymentProgress('Uploading documents...')
      const [idPayload, photoPayload, paymentPayload] = await Promise.all([
        uploadPrivateFile(prebookIdProof, 'identity'), uploadPrivateFile(prebookPhoto, 'photos'), uploadPrivateFile(prebookPaymentScreenshot, 'payments'),
      ])
      setPrebookPaymentProgress('Submitting pre-booking...')
      const response = await fetchWithTimeout('/api/visitor/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'prebooking', propertyId: resolvedPropertyId, roomId: prebookRoomId, form: prebookForm,
          expectedMoveIn: prebookForm.move_in_date,
          files: { idProof: idPayload, photo: photoPayload, payment: paymentPayload },
          transactionId: prebookTransactionId,
        }),
      }, 30000)
      const result = await readApiResponse(response, 'Pre-booking submission failed')
      if (!response.ok) throw new Error(result.error || 'Submission failed')
      toast.success(result.message || 'Your pre-booking request has been submitted and is awaiting owner verification.')
      setShowPrebookPaymentModal(false)
      setPrebookForm({ name: '', phone: '', email: '', move_in_date: '', message: '' })
      setPrebookRoomId(null); setPrebookIdProof(null); setPrebookPhoto(null)
      setPrebookPaymentScreenshot(null); setPrebookTransactionId(''); setAgreeTerms(false)
      setPrebookPolicyConsent(false); setPrebookConsentError('')
      return

      const idProofUrl = await uploadFile(prebookIdProof, 'prebook_id')
      const photoUrl = await uploadFile(prebookPhoto, 'prebook_photo')
      const screenshotUrl = await uploadFile(prebookPaymentScreenshot, 'prebook_pay')

      const prebookData = {
        property_id: id,
        room_id: prebookRoomId,
        user_id: null,
        name: prebookForm.name.trim(),
        phone: cleanPhone,
        email: prebookForm.email.trim(),
        message: prebookForm.message?.trim() || null,
        expected_move_in_date: prebookForm.move_in_date,
        id_proof: idProofUrl,
        photo: photoUrl,
        status: 'pending',
        payment_status: 'pending',
        pre_booking_fee_amount: ownerSettings.pre_booking_fee,
        payment_screenshot: screenshotUrl,
        payment_transaction_id: prebookTransactionId || null,
        created_at: new Date().toISOString()
      }
      const { error } = await supabase.from('pre_bookings').insert(prebookData)
      if (error) throw error
      toast.success('Pre‑booking request sent! Owner will verify payment and approve.')
      setShowPrebookPaymentModal(false)
      setPrebookForm({ name: '', phone: '', email: '', move_in_date: '', message: '' })
      setPrebookRoomId(null)
      setPrebookIdProof(null)
      setPrebookPhoto(null)
      setPrebookPaymentScreenshot(null)
      setPrebookTransactionId('')
      setAgreeTerms(false)
    } catch (error) {
      console.error('Pre-booking error:', error)
      toast.error('Failed to submit pre‑booking: ' + (error.message || 'Unknown error'))
    } finally {
      setPrebookPaymentSubmitting(false)
      setPrebookPaymentProgress('')
    }
  }

  const nextImage = () => {
    if (property?.photos && currentImageIndex < property.photos.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1)
    }
  }

  const prevImage = () => {
    if (currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1)
    }
  }

  // Reset form when closing payment modal (optional)
  const closePaymentModal = () => {
    if (paymentSubmitting) return
    setShowPaymentModal(false)
    // Optionally clear payment screenshot but keep form data? We'll keep it for retry.
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-500">Loading property details...</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50"><div className="max-w-md text-center bg-white p-8 rounded-2xl border"><p className="text-red-600 mb-5">{loadError}</p><button onClick={loadData} className="btn-primary">Try again</button></div></div>
  }

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-white">
        <div className="text-center">
          <div className="text-6xl mb-4">🏠</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Property not found</h1>
          <Link href="/" className="text-slate-600 hover:text-slate-800 inline-flex items-center gap-2">
            ← Back to Home
          </Link>
        </div>
      </div>
    )
  }

  const hasNoRooms = rooms.length === 0
  const isApplyFormValid = applyForm.name && phoneValid && emailValid && applyForm.bloodGroup && idProof && photo
  const isPrebookFormValid = prebookForm.name && prebookPhoneValid && prebookEmailValid && prebookIdProof && prebookPhoto && agreeTerms && prebookForm.move_in_date
  const validOwnerUpiId = typeof ownerSettings.upi_id === 'string' && /^[^\s@]+@[^\s@]+$/.test(ownerSettings.upi_id.trim())
  const validPaymentPhone = typeof ownerSettings.upi_phone === 'string' && /^\+?\d{10,15}$/.test(ownerSettings.upi_phone.replace(/[\s()-]/g, ''))
  const city = property.city || 'India'
  const propertyType = getPropertyTypeLabel(property.property_type)
  const amenities = Array.isArray(property.amenities) ? property.amenities.filter(Boolean) : []
  const rents = rooms.map(room => Number(room.monthly_rent)).filter(Number.isFinite)
  const minRent = rents.length ? Math.min(...rents) : null
  const maxRent = rents.length ? Math.max(...rents) : null
  const rentText = minRent == null ? 'Contact the property for current rent' : minRent === maxRent ? `${formatCurrency(minRent)} per month` : `${formatCurrency(minRent)}–${formatCurrency(maxRent)} per month`
  const roomTypes = [...new Set(rooms.map(room => getSharingDetails(room.sharing_type)?.label).filter(Boolean))]
  const availableSlots = rooms.reduce((total, room) => {
    const physicalVacancies = Math.max(
      0,
      Number(room.capacity || 0) - Number(room.current_occupants || 0),
    )
    const reservedVacancies = Number(room.reserved_prebooking_count || 0)
    return total + Math.max(0, physicalVacancies - reservedVacancies)
  }, 0)
  const genderLabel = property.property_type === 'boys' ? 'Boys' : property.property_type === 'girls' ? 'Girls' : 'Co-living'
  const locality = property.address || city
  const fullAddress = property.formatted_address || [property.address, property.city, property.pincode].filter(Boolean).join(', ')
  const foodAmenity = amenities.find(amenity => /food|meal|mess/i.test(amenity))
  const roomTypeText = roomTypes.length ? roomTypes.join(', ') : `${propertyType} rooms`
  const amenityPreview = amenities.slice(0, 4).join(', ')
  const seoTitle = `${property.name} in ${city} | Rooms, Rent & Hostel Details - HostelSet`
  const seoDescription = `${property.name} in ${locality}: view ${roomTypeText}, ${rentText}, availability${amenityPreview ? `, facilities like ${amenityPreview}` : ''}, and apply online through HostelSet.`
  const canonicalUrl = `${SITE_URL}${propertyPublicPath(property)}`
  const absoluteImage = (() => {
    const candidate = property.photos?.[0] || '/brand/logo-primary.png'
    try { return new URL(candidate, SITE_URL).toString() }
    catch { return `${SITE_URL}/brand/logo-primary.png` }
  })()
  const imageAlt = `${property.name} hostel in ${city}`
  const lodgingSchema = {
    '@context': 'https://schema.org', '@type': ['LodgingBusiness', 'LocalBusiness'], name: property.name,
    description: property.description || seoDescription,
    image: property.photos?.length ? property.photos.map(photo => { try { return new URL(photo, SITE_URL).toString() } catch { return absoluteImage } }) : [absoluteImage],
    url: canonicalUrl,
    address: { '@type': 'PostalAddress', streetAddress: property.formatted_address || property.address, addressLocality: city, postalCode: property.pincode || undefined, addressCountry: 'IN' },
    telephone: property.contact_number || undefined,
    amenityFeature: amenities.map(amenity => ({ '@type': 'LocationFeatureSpecification', name: amenity, value: true })),
    geo: Number.isFinite(property.latitude) && Number.isFinite(property.longitude) ? { '@type': 'GeoCoordinates', latitude: property.latitude, longitude: property.longitude } : undefined,
    priceRange: minRent == null ? undefined : rentText,
    makesOffer: rooms.map(room => ({
      '@type': 'Offer',
      name: `${getSharingDetails(room.sharing_type)?.label || 'Room'} at ${property.name}`,
      price: Number(room.monthly_rent),
      priceCurrency: 'INR',
      availability: Number(room.current_occupants || 0) + Number(room.reserved_prebooking_count || 0) < Number(room.capacity || 0) ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url: canonicalUrl,
    })),
    subjectOf: property.photos?.map((photo, index) => ({ '@type': 'ImageObject', contentUrl: (() => { try { return new URL(photo, SITE_URL).toString() } catch { return absoluteImage } })(), caption: `${imageAlt} - photo ${index + 1}` })),
  }
  const breadcrumbSchema = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Properties', item: `${SITE_URL}/properties` },
      { '@type': 'ListItem', position: 3, name: property.name, item: canonicalUrl },
    ],
  }
  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'HostelSet',
    url: SITE_URL,
    logo: `${SITE_URL}/brand/logo-primary.png`,
  }
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'HostelSet',
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/properties?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
  const jsonLd = JSON.stringify([organizationSchema, websiteSchema, lodgingSchema, breadcrumbSchema]).replace(/</g, '\\u003c')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <Head>
        <title>{seoTitle}</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="HostelSet" />
        <meta property="og:title" content={seoTitle} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={absoluteImage} />
        <meta property="og:image:alt" content={imageAlt} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seoTitle} />
        <meta name="twitter:description" content={seoDescription} />
        <meta name="twitter:url" content={canonicalUrl} />
        <meta name="twitter:image" content={absoluteImage} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      </Head>
      {/* Header – unchanged */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <BrandLogo />
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/login/tenant" className="text-gray-600 hover:text-slate-800 transition">Tenant Login</Link>
              <Link href="/register" className="bg-slate-800 text-white px-4 py-2 rounded-full text-sm font-semibold hover:bg-slate-700 transition shadow-md">
                Register Your Property
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Link href="/properties" className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition group">
          <span className="group-hover:-translate-x-1 transition">←</span> Back to Search
        </Link>

        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-2">{property.name}</h1>
          <div className="flex flex-wrap items-center gap-4 text-slate-500">
            <span className="flex items-center gap-1">📍 {property.address}, {property.city}</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            {property.rating && property.total_reviews > 0 && <span className="flex items-center gap-1">⭐ {property.rating} ({property.total_reviews} reviews)</span>}
          </div>
        </div>

        {/* Gallery – unchanged */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          <div className="relative bg-slate-100">
            {property.photos && property.photos.length > 0 ? (
              <>
                <div className="relative h-[260px] w-full sm:h-[400px] md:h-[500px]"><Image src={property.photos[currentImageIndex]} alt={imageAlt} fill priority sizes="(max-width: 768px) 100vw, 1152px" className="object-cover" /></div>
                {property.photos.length > 1 && (
                  <>
                    <button onClick={prevImage} className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-slate-800 p-2 rounded-full shadow-md transition backdrop-blur-sm">←</button>
                    <button onClick={nextImage} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-slate-800 p-2 rounded-full shadow-md transition backdrop-blur-sm">→</button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                      {property.photos.map((_, i) => (
                        <button key={i} onClick={() => setCurrentImageIndex(i)} className={`w-2 h-2 rounded-full transition ${i === currentImageIndex ? 'bg-white w-4' : 'bg-white/50'}`} />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex min-h-32 w-full items-center gap-4 bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white sm:min-h-40"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-2xl font-black" aria-hidden="true">H</div><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.2em] text-orange-300">HostelSet property</p><p className="mt-1 truncate text-xl font-black">{property.name}</p><p className="mt-1 truncate text-sm text-slate-300">{property.city || 'Location available on request'}</p></div></div>
            )}
          </div>
          {property.photos && property.photos.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
              {property.photos.map((photo, i) => (
                <button key={i} onClick={() => setCurrentImageIndex(i)} className={`w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${i === currentImageIndex ? 'border-slate-800' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                  <Image src={photo} alt={`${imageAlt} - photo ${i + 1}`} width={80} height={80} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tabs – unchanged */}
        <div className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Property details">
          <button role="tab" aria-selected={activeTab === 'rooms'} onClick={() => setActiveTab('rooms')} className={`min-w-0 rounded-xl border px-1 py-2.5 text-xs font-bold transition sm:text-sm ${activeTab === 'rooms' ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}`}>
            🏠 Rooms & Availability
          </button>
          <button role="tab" aria-selected={activeTab === 'amenities'} onClick={() => setActiveTab('amenities')} className={`min-w-0 rounded-xl border px-1 py-2.5 text-xs font-bold transition sm:text-sm ${activeTab === 'amenities' ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}`}>
            ✨ Amenities
          </button>
          <button role="tab" aria-selected={activeTab === 'about'} onClick={() => setActiveTab('about')} className={`min-w-0 rounded-xl border px-1 py-2.5 text-xs font-bold transition sm:text-sm ${activeTab === 'about' ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}`}>
            📖 About
          </button>
        </div>

        {/* Rooms Tab */}
        {activeTab === 'rooms' && (
          <>
            {hasNoRooms ? (
              <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-12 text-center border border-slate-100">
                <div className="text-5xl mb-4">🏠</div>
                <h3 className="text-xl font-semibold text-slate-800 mb-2">No Rooms Available</h3>
                <p className="text-slate-500">This property currently has no rooms listed. Please check back later.</p>
              </div>
            ) : (
              <div className="grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
                {rooms.map((room) => {
                  const sharing = getSharingDetails(room.sharing_type)
                  const capacity = Number(room.capacity || 0)
                  const occupants = Number(room.current_occupants || 0)
                  const physicalAvailableSlots = Math.max(0, capacity - occupants)
                  const roomVacate = vacateInfo[room.id]
                  const activeReservations = Number(reservationCounts[room.id] || 0)
                  const availableSlots = Math.max(0, physicalAvailableSlots - activeReservations)
                  const isAvailable = availableSlots > 0
                  const isReserved = activeReservations > 0 && availableSlots === 0
                  const isPrebookable = capacity > 0 && occupants >= capacity && Boolean(roomVacate) && !isReserved

                  let badgeText = ''
                  let badgeColor = ''
                  if (isReserved) {
                    badgeText = 'Reserved'
                    badgeColor = 'bg-purple-100 text-purple-700'
                  } else if (activeReservations > 0) {
                    badgeText = `${availableSlots} unreserved bed${availableSlots === 1 ? '' : 's'} available`
                    badgeColor = 'bg-violet-100 text-violet-700'
                  } else if (isAvailable) {
                    badgeText = `${availableSlots} bed${availableSlots === 1 ? '' : 's'} available now`
                    badgeColor = 'bg-green-100 text-green-700'
                  } else if (isPrebookable) {
                    badgeText = 'Pre‑bookable'
                    badgeColor = 'bg-blue-100 text-blue-700'
                  } else {
                    badgeText = 'Full'
                    badgeColor = 'bg-slate-100 text-slate-500'
                  }

                  return (
                    <motion.div
                      key={room.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`group flex h-full min-w-0 flex-col rounded-2xl border bg-white text-slate-900 shadow-md transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${
                        isAvailable ? 'border-green-200 hover:border-green-400' : (isPrebookable ? 'border-blue-200 hover:border-blue-400' : 'border-slate-200 dark:border-slate-700')
                      }`}
                    >
                      <div className="flex h-full min-w-0 flex-col p-5 sm:p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Room {room.room_number}</h3>
                            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">{sharing.label} {sharing.icon}</p>
                            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${room.room_audience === 'boys' ? 'bg-blue-100 text-blue-700' : room.room_audience === 'girls' ? 'bg-pink-100 text-pink-700' : 'bg-violet-100 text-violet-700'}`}>{room.room_audience === 'boys' ? 'Boys Room' : room.room_audience === 'girls' ? 'Girls Room' : 'Co-living Room'}</span>
                          </div>
                          <span className={`max-w-[55%] shrink-0 whitespace-normal break-words rounded-full px-3 py-1 text-center text-xs font-semibold leading-tight ${badgeColor}`}>
                            {badgeText}
                          </span>
                        </div>
                        <div className="mb-4">
                          <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{formatCurrency(room.monthly_rent)}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">per month</p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Application deposit: <span className="font-semibold text-slate-700 dark:text-slate-300">{formatCurrency(getRoomApplicationDeposit())}</span></p>
                        </div>
                        <div className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-500 dark:text-slate-400">Occupancy</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{occupants}/{capacity}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className="h-2 rounded-full bg-slate-600 transition-all duration-150 dark:bg-slate-300" style={{ width: `${capacity ? (occupants / capacity) * 100 : 0}%` }} />
                          </div>
                          <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {activeReservations > 0
                              ? `${activeReservations} active reservation${activeReservations === 1 ? '' : 's'}`
                              : 'No active reservations'}
                          </p>
                        </div>
                        <div className="mt-auto pt-2">
                        {roomVacate && isPrebookable && (
                          <div className="mt-2 mb-2">
                            <span className="inline-block rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                              {roomVacate.daysLeft > 1 ? `Vacates in ${roomVacate.daysLeft} days` : roomVacate.daysLeft === 1 ? 'Vacates tomorrow' : 'Ready to vacate'}
                            </span>
                          </div>
                        )}
                        {isReserved ? (
                          <button disabled className="w-full cursor-not-allowed rounded-xl bg-slate-300 py-3 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            Reserved - Next vacancy already booked
                          </button>
                        ) : isAvailable ? (
                          <button onClick={() => { setSelectedRoom(room.id); setShowApplyModal(true) }} className="w-full rounded-xl bg-slate-800 py-3 font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:bg-slate-700 dark:hover:bg-slate-600 dark:focus:ring-offset-slate-900">
                            Apply for this Hostel →
                          </button>
                        ) : isPrebookable ? (
                          <button onClick={() => openPrebookModal(room.id, roomVacate?.vacateDate)} className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900">
                            📅 Pre‑book this room
                          </button>
                        ) : (
                          <button disabled className="w-full cursor-not-allowed rounded-xl bg-slate-300 py-3 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            Full – Not available
                          </button>
                        )}
                        {isAvailable && isPrebookable && (
                          <button onClick={() => openPrebookModal(room.id, roomVacate?.vacateDate)} className="mt-2 w-full rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60">
                            Pre-book future bed
                          </button>
                        )}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Amenities Tab – unchanged */}
        {activeTab === 'amenities' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:p-8">
            <h2 className="mb-4 text-xl font-bold text-slate-900 dark:text-white">Amenities & Facilities</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {(property.amenities || []).map((amenity, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden="true">✓</span>
                  <span>{amenity}</span>
                </div>
              ))}
            </div>
            {!(property.amenities || []).length && <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">No amenities have been listed for this property yet.</p>}
          </div>
        )}

        {/* About Tab – unchanged */}
        {activeTab === 'about' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:p-8">
            <h2 className="mb-4 text-xl font-bold text-slate-900 dark:text-white">About this Property</h2>
            <p className="leading-relaxed text-slate-700 dark:text-slate-200">{property.description || 'No description provided.'}</p>
            <div className="mt-6 pt-6 border-t border-slate-200">
              <h3 className="font-semibold text-slate-800 mb-2">Property Details</h3>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Property Type</span>
                  <span className="text-slate-700">{getPropertyTypeLabel(property.property_type)}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Total Rooms</span>
                  <span className="text-slate-700">{rooms.length}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Location</span>
                  <span className="text-slate-700">{property.city}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Listed Since</span>
                  <span className="text-slate-700">{new Date(property.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="property-answers-title">
          <h2 id="property-answers-title" className="text-2xl font-bold text-slate-800">What is this property?</h2>
          <p className="mt-3 text-slate-600">{property.description || `${property.name} is a ${propertyType.toLowerCase()} accommodation listing in ${city}. Review the available rooms, rent and facilities below before applying.`}</p>

          <dl className="mt-6 grid gap-x-8 gap-y-3 rounded-xl bg-slate-50 p-5 text-sm sm:grid-cols-2">
            <div><dt className="font-semibold text-slate-700">Hostel type and gender</dt><dd className="mt-1 text-slate-600">{propertyType} · {genderLabel}</dd></div>
            <div><dt className="font-semibold text-slate-700">City</dt><dd className="mt-1 text-slate-600">{city}</dd></div>
            <div><dt className="font-semibold text-slate-700">Locality</dt><dd className="mt-1 text-slate-600">{locality}</dd></div>
            <div><dt className="font-semibold text-slate-700">Pin code</dt><dd className="mt-1 text-slate-600">{property.pincode || 'Not provided'}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-slate-700">Full address</dt><dd className="mt-1 text-slate-600">{fullAddress}</dd></div>
            <div><dt className="font-semibold text-slate-700">Nearby landmark</dt><dd className="mt-1 text-slate-600">{property.nearby_landmark || 'No landmark has been listed.'}</dd></div>
            <div><dt className="font-semibold text-slate-700">Map coordinates</dt><dd className="mt-1 text-slate-600">{Number.isFinite(property.latitude) && Number.isFinite(property.longitude) ? `${property.latitude}, ${property.longitude}` : 'Not available'}</dd></div>
            <div><dt className="font-semibold text-slate-700">Room types</dt><dd className="mt-1 text-slate-600">{roomTypes.length ? roomTypes.join(', ') : 'No rooms currently listed'}</dd></div>
            <div><dt className="font-semibold text-slate-700">Rent range</dt><dd className="mt-1 text-slate-600">{rentText}</dd></div>
            <div className="sm:col-span-2"><dt className="font-semibold text-slate-700">Amenities</dt><dd className="mt-1 text-slate-600">{amenities.length ? amenities.join(', ') : 'No amenities have been listed.'}</dd></div>
          </dl>

          <div className="mt-8 grid gap-7 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Who is it suitable for?</h3>
              <p className="mt-2 text-slate-600">This listing is marked for {genderLabel.toLowerCase()} accommodation. Applicants should review the individual room audience and property rules before applying.</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Is this hostel available?</h3>
              <p className="mt-2 text-slate-600">{availableSlots > 0 ? `Yes. The currently listed rooms show ${availableSlots} available slot${availableSlots === 1 ? '' : 's'} in total.` : 'No immediate room slots are shown. A room may still offer pre-booking when an approved vacate date is listed.'}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">What room types are available?</h3>
              <p className="mt-2 text-slate-600">{rooms.length ? `${rooms.length} room option${rooms.length === 1 ? '' : 's'} ${roomTypes.length ? `include ${roomTypes.join(', ')}` : 'are listed'}.` : 'No rooms are currently listed for this property.'}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">How much is the rent?</h3>
              <p className="mt-2 text-slate-600">The current listed room rent is {rentText}. Check the selected room and confirm current charges with the owner before joining.</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">What amenities are included?</h3>
              <p className="mt-2 text-slate-600">{amenities.length ? `The owner has listed: ${amenities.join(', ')}.` : 'The owner has not listed any amenities yet.'}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Is food included?</h3>
              <p className="mt-2 text-slate-600">{foodAmenity ? `${foodAmenity} is included in the amenities listed by the owner. Confirm meal timings and charges directly with the owner.` : 'Food is not specified as an included amenity in this listing. Ask the owner before applying.'}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">How can I apply?</h3>
              <p className="mt-2 text-slate-600">Choose an available room, select Apply for this Hostel, provide the requested applicant details and documents, then submit the application payment reference and proof for owner review. After approval, you will receive account access and login instructions.</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">How does payment work?</h3>
              <p className="mt-2 text-slate-600">Pay using the owner’s displayed UPI details, then submit the UPI transaction reference and screenshot. The owner manually verifies the proof. Room rent is separate from the application/security deposit unless clearly stated otherwise.</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">What documents are required?</h3>
              <p className="mt-2 text-slate-600">The application asks for an ID proof such as Aadhaar or PAN, a passport-size photo, and payment proof with the UPI transaction reference.</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">How do I contact the owner?</h3>
              <p className="mt-2 text-slate-600">{property.contact_number ? `The public contact number listed for this property is ${property.contact_number}.` : 'A public owner contact number is not listed. Submit an application or use HostelSet support for platform assistance.'}</p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">How far is it from major landmarks?</h3>
              <p className="mt-2 text-slate-600">{property.nearby_landmark ? `${property.nearby_landmark} is the nearby landmark supplied by the owner. Use the map directions below to check the exact route and distance.` : 'No major landmark distance has been supplied. Use the map and directions below to calculate the route from your destination.'}</p>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <Link href="/properties" className="font-semibold text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">Browse all properties</Link>
            {similarProperties.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-slate-800">More properties in {city}</h3>
                <div className="mt-2 flex flex-wrap gap-3">
                  {similarProperties.map(similar => (
                    <Link key={similar.id} href={propertyPublicPath(similar)} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">{similar.name}</Link>
                  ))}
                </div>
              </div>
            )}
            {similarProperties.some(similar => similar.address || similar.formatted_address) && <div className="mt-4"><h3 className="font-semibold text-slate-800">Nearby localities</h3><div className="mt-2 flex flex-wrap gap-3">{similarProperties.filter(similar => similar.address || similar.formatted_address).map(similar => <Link key={`locality-${similar.id}`} href={propertyPublicPath(similar)} className="text-sm font-medium text-orange-700 underline dark:text-orange-300">{similar.address || similar.formatted_address}</Link>)}</div></div>}
            <div className="mt-4 flex flex-wrap gap-4 text-sm"><Link href="/about" className="font-semibold text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">About HostelSet</Link><Link href="/support" className="font-semibold text-orange-700 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200">Support</Link></div>
          </div>
        </section>

        {Number.isFinite(property.latitude) && Number.isFinite(property.longitude) && (
          <section className="mt-10 border-t border-slate-200 pt-8" aria-labelledby="property-location-title">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 id="property-location-title" className="text-lg font-bold text-slate-800">Find this property</h2><p className="text-sm text-slate-500">{property.formatted_address || property.address}</p></div>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${property.latitude},${property.longitude}`} target="_blank" rel="noreferrer" className="rounded-full bg-slate-800 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-slate-700">Open Directions</a>
            </div>
            <NearbyHostelMap properties={[property]} userLocation={null} compact />
          </section>
        )}
      </div>

      {/* ========== MODALS ========== */}

      {/* Apply Modal – unchanged except for submitApplication handler */}
      <AnimatePresence>
        {showApplyModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowApplyModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Apply for this Hostel</h2>
                  <p className="mt-1 text-xs text-slate-500">After approval, you’ll receive account access and login instructions.</p>
                </div>
                <button onClick={() => setShowApplyModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">✕</button>
              </div>
              <div className="space-y-4">
                <input type="text" placeholder="Full Name *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400" value={applyForm.name} onChange={(e) => setApplyForm({...applyForm, name: e.target.value})} />
                <div>
                  <div className="flex gap-2">
                    <span className="bg-slate-100 px-4 py-3 rounded-xl border border-slate-200 text-gray-600">+91</span>
                    <input 
                      type="tel" 
                      placeholder="Phone Number *" 
                      className={`flex-1 px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 ${phoneError ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 focus:ring-slate-400'}`}
                      value={applyForm.phone} 
                      onChange={(e) => { setApplyForm({...applyForm, phone: e.target.value}); setPhoneValid(false); setPhoneError('') }}
                      onBlur={handlePhoneBlur}
                      maxLength={10}
                    />
                  </div>
                  {phoneError && <p className="text-red-500 text-xs mt-1">{phoneError}</p>}
                  {checkingPhone && <p className="text-gray-400 text-xs mt-1">Checking...</p>}
                </div>
                <div>
                  <input 
                    type="email" 
                    placeholder="Email * (will be used for login)" 
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 ${emailError ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 focus:ring-slate-400'}`}
                    value={applyForm.email} 
                    onChange={(e) => { setApplyForm({...applyForm, email: e.target.value}); setEmailValid(false); setEmailError('') }}
                    onBlur={handleEmailBlur}
                    required
                  />
                  {emailError && <p className="text-red-500 text-xs mt-1">{emailError}</p>}
                  {checkingEmail && <p className="text-gray-400 text-xs mt-1">Checking...</p>}
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  Blood group *
                  <select required value={applyForm.bloodGroup} onChange={(e) => setApplyForm({...applyForm, bloodGroup: e.target.value})} className="mt-1 w-full px-4 py-3 border border-slate-200 rounded-xl bg-white">
                    <option value="">Select blood group</option>
                    {BLOOD_GROUPS.map(group => <option key={group} value={group}>{group}</option>)}
                  </select>
                </label>
                <textarea placeholder="Any message for the owner?" rows="3" className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none" value={applyForm.message} onChange={(e) => setApplyForm({...applyForm, message: e.target.value})} />
                <div>
                  <label className="block text-sm font-semibold mb-1">ID Proof (Aadhaar/PAN) *</label>
                  <input type="file" accept="image/*,.pdf" onChange={e => handleFileChange(e, setIdProof)} className="w-full" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Passport Size Photo *</label>
                  <input type="file" accept="image/*" onChange={e => handleFileChange(e, setPhoto)} className="w-full" />
                  {photoPreview && <img src={photoPreview} alt="Selected profile photo preview" className="mt-2 h-20 w-20 rounded-full object-cover" />}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start gap-2"><input type="checkbox" id="applicationPolicyConsent" checked={applicationConsent} onChange={event => { setApplicationConsent(event.target.checked); if (event.target.checked) setApplicationConsentError('') }} className="mt-1" /><label htmlFor="applicationPolicyConsent" className="text-sm text-slate-700">I have read and agree to HostelSet’s <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Privacy Policy</Link> and <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Terms &amp; Conditions</Link>.</label></div>
                  {applicationConsentError && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{applicationConsentError}</p>}
                </div>
                <button 
                  onClick={submitApplication} 
                  disabled={applySubmitting || !isApplyFormValid || checkingPhone || checkingEmail} 
                  className="w-full bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applySubmitting ? 'Submitting...' : 'Continue to Payment'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Application/security confirmation payment modal */}
      <AnimatePresence>
        {showPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] pt-[calc(0.5rem_+_env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:p-4" onClick={closePaymentModal}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:max-h-[90vh] sm:p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="mb-4 text-2xl font-bold text-slate-900 dark:text-white">Application / Security Deposit</h2>
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <p className="text-sm text-gray-600">Room {selectedRoomDetails?.room_number} – {getSharingDetails(selectedRoomDetails?.sharing_type)?.label}</p>
                <p className="text-lg font-bold mt-1">Application / Security Deposit: {formatCurrency(calculateTotalAmount())}</p>
                <p className="text-sm font-semibold text-red-700 mt-1">Non-refundable</p>
                <p className="text-xs text-gray-600 mt-2">This deposit is only for application/security confirmation. Room rent is separate and must be paid after joining.</p>
              </div>
              {(validOwnerUpiId || validPaymentPhone) && (
                <div className="mb-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-slate-900 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-100">
                  {validOwnerUpiId && <div><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">UPI ID</p><p className="break-all font-mono text-sm font-semibold">{ownerSettings.upi_id}</p><button type="button" aria-label="Copy owner UPI ID" onClick={() => copyPaymentDestination(ownerSettings.upi_id, 'UPI ID copied')} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-orange-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white">Copy UPI ID</button></div>}
                  {validPaymentPhone && <div><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Payment phone number</p><p className="break-all font-mono text-sm font-semibold">{ownerSettings.upi_phone}</p><button type="button" aria-label="Copy owner payment phone number" onClick={() => copyPaymentDestination(ownerSettings.upi_phone, 'Phone number copied')} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-orange-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white">Copy Phone Number</button></div>}
                  {copyFeedback && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300" role="status">{copyFeedback}</p>}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">UPI Transaction ID / UTR *</label>
                  <input type="text" className="w-full px-4 py-3 border border-slate-200 rounded-xl" value={transactionId} onChange={e => setTransactionId(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Payment Screenshot *</label>
                  <input type="file" accept="image/*" onChange={e => handleFileChange(e, setPaymentScreenshot)} className="w-full" />
                </div>
                {!ownerSettings.upi_id && (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                    Owner payment details are not configured. You cannot submit payment until the owner sets a UPI ID.
                  </div>
                )}
                <div className="bg-yellow-50 p-3 rounded-lg text-sm text-yellow-800">
                  After payment, your application will be submitted. You will receive an email once the owner approves.
                </div>
                <div className="bg-red-50 border border-red-100 p-3 rounded-lg text-sm text-red-800">
                  Submitting fake payment proof, wrong UPI transaction ID, or false documents may lead to rejection and legal/cybercrime action.
                </div>
                <button onClick={submitPayment} disabled={paymentSubmitting || !ownerSettings.upi_id} className="w-full bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-700 transition disabled:opacity-50">
                  {paymentSubmitting ? paymentProgress || 'Processing...' : 'I Have Paid – Submit'}
                </button>
                <button onClick={closePaymentModal} disabled={paymentSubmitting} className="w-full text-center text-slate-500 text-sm disabled:opacity-50">Cancel</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pre‑booking modals – unchanged */}
      <AnimatePresence>
        {showPrebookModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowPrebookModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-slate-800">Pre‑book Room</h2>
                <button onClick={() => setShowPrebookModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">✕</button>
              </div>
              <div className="space-y-4">
                <input type="text" placeholder="Full Name *" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400" value={prebookForm.name} onChange={e => setPrebookForm({...prebookForm, name: e.target.value})} />
                <div>
                  <div className="flex gap-2">
                    <span className="bg-slate-100 px-4 py-3 rounded-xl border border-slate-200 text-gray-600">+91</span>
                    <input 
                      type="tel" 
                      placeholder="Phone Number *" 
                      className={`flex-1 px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 ${prebookPhoneError ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-400'}`}
                      value={prebookForm.phone} 
                      onChange={(e) => { setPrebookForm({...prebookForm, phone: e.target.value}); setPrebookPhoneValid(false); setPrebookPhoneError('') }}
                      onBlur={handlePrebookPhoneBlur}
                      maxLength={10}
                    />
                  </div>
                  {prebookPhoneError && <p className="text-red-500 text-xs mt-1">{prebookPhoneError}</p>}
                  {prebookCheckingPhone && <p className="text-gray-400 text-xs mt-1">Checking...</p>}
                </div>
                <div>
                  <input 
                    type="email" 
                    placeholder="Email *" 
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 ${prebookEmailError ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-400'}`}
                    value={prebookForm.email} 
                    onChange={(e) => { setPrebookForm({...prebookForm, email: e.target.value}); setPrebookEmailValid(false); setPrebookEmailError('') }}
                    onBlur={handlePrebookEmailBlur}
                    required
                  />
                  {prebookEmailError && <p className="text-red-500 text-xs mt-1">{prebookEmailError}</p>}
                  {prebookCheckingEmail && <p className="text-gray-400 text-xs mt-1">Checking...</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Expected Move‑in Date *</label>
                  <input type="date" className="w-full px-4 py-3 border border-slate-200 rounded-xl" value={prebookForm.move_in_date} onChange={e => setPrebookForm({...prebookForm, move_in_date: e.target.value})} min={new Date().toISOString().split('T')[0]} />
                  <p className="text-xs text-gray-400 mt-1">Based on the current tenant’s vacate date.</p>
                </div>
                <textarea placeholder="Any message for the owner?" rows="3" className="w-full px-4 py-3 border border-slate-200 rounded-xl resize-none" value={prebookForm.message} onChange={(e) => setPrebookForm({...prebookForm, message: e.target.value})} />
                <div>
                  <label className="block text-sm font-semibold mb-1">ID Proof (Aadhaar/PAN) *</label>
                  <input type="file" accept="image/*,.pdf" onChange={e => handleFileChange(e, setPrebookIdProof)} className="w-full" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Passport Size Photo *</label>
                  <input type="file" accept="image/*" onChange={e => handleFileChange(e, setPrebookPhoto)} className="w-full" />
                  {prebookPhotoPreview && <img src={prebookPhotoPreview} alt="Selected pre-booking profile photo preview" className="mt-2 h-20 w-20 rounded-full object-cover" />}
                </div>
                <div className="flex items-start gap-2">
                  <input type="checkbox" id="prebookTerms" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} className="mt-1" />
                  <label htmlFor="prebookTerms" className="text-sm text-gray-600">
                    I agree that the pre‑booking fee of <strong>{formatCurrency(ownerSettings.pre_booking_fee)}</strong> is <strong>non‑refundable</strong>. If I do not move in by the expected date, my booking will be automatically cancelled and the fee will not be returned.
                  </label>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start gap-2"><input type="checkbox" id="prebookPolicyConsent" checked={prebookPolicyConsent} onChange={event => { setPrebookPolicyConsent(event.target.checked); if (event.target.checked) setPrebookConsentError('') }} className="mt-1" /><label htmlFor="prebookPolicyConsent" className="text-sm text-slate-700">I have read and agree to HostelSet’s <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Privacy Policy</Link> and <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">Terms &amp; Conditions</Link>.</label></div>
                  {prebookConsentError && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{prebookConsentError}</p>}
                </div>
                <button 
                  onClick={submitPreBookingForm} 
                  disabled={prebookSubmitting || !isPrebookFormValid || prebookCheckingPhone || prebookCheckingEmail} 
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {prebookSubmitting ? 'Submitting...' : 'Proceed to Payment'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPrebookPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] pt-[calc(0.5rem_+_env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:p-4" onClick={() => { if (!prebookPaymentSubmitting) setShowPrebookPaymentModal(false) }}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-h-[calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:max-h-[90vh] sm:p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="mb-4 text-2xl font-bold text-slate-900 dark:text-white">Pay Pre‑booking Fee</h2>
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <p className="text-sm text-gray-600">Room {rooms.find(r => r.id === prebookRoomId)?.room_number}</p>
                <p className="text-lg font-bold mt-1">Non‑refundable Fee: {formatCurrency(ownerSettings.pre_booking_fee)}</p>
                <p className="text-xs text-slate-500 mt-1">This amount will be adjusted against your first month's rent.</p>
                <div className="mt-2 p-2 bg-yellow-100 rounded text-xs text-yellow-800">
                  ⚠️ If you do not move in by the expected date, your booking will be cancelled and the fee will not be refunded.
                </div>
              </div>
              {(validOwnerUpiId || validPaymentPhone) && (
                <div className="mb-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-slate-900 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-100">
                  {validOwnerUpiId && <div><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">UPI ID</p><p className="break-all font-mono text-sm font-semibold">{ownerSettings.upi_id}</p><button type="button" aria-label="Copy owner UPI ID" onClick={() => copyPaymentDestination(ownerSettings.upi_id, 'UPI ID copied')} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-white">Copy UPI ID</button></div>}
                  {validPaymentPhone && <div><p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Payment phone number</p><p className="break-all font-mono text-sm font-semibold">{ownerSettings.upi_phone}</p><button type="button" aria-label="Copy owner payment phone number" onClick={() => copyPaymentDestination(ownerSettings.upi_phone, 'Phone number copied')} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-white">Copy Phone Number</button></div>}
                  {copyFeedback && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300" role="status">{copyFeedback}</p>}
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">UPI Transaction ID / UTR *</label>
                  <input type="text" className="w-full px-4 py-3 border border-slate-200 rounded-xl" value={prebookTransactionId} onChange={e => setPrebookTransactionId(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Payment Screenshot *</label>
                  <input type="file" accept="image/*" onChange={e => handleFileChange(e, setPrebookPaymentScreenshot)} className="w-full" required />
                </div>
                {!ownerSettings.upi_id && (
                  <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                    Owner payment details are not configured. You cannot submit payment until the owner sets a UPI ID.
                  </div>
                )}
                <div className="bg-yellow-50 p-3 rounded-lg text-sm text-yellow-800">
                  After payment, upload the screenshot and submit. Owner will verify and approve your pre‑booking.
                </div>
                <button onClick={submitPreBookingPayment} disabled={prebookPaymentSubmitting || !ownerSettings.upi_id} className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold hover:bg-green-700 transition disabled:opacity-50">
                  {prebookPaymentSubmitting ? prebookPaymentProgress || 'Submitting...' : 'Submit Payment Proof'}
                </button>
                <button onClick={() => { if (!prebookPaymentSubmitting) setShowPrebookPaymentModal(false) }} disabled={prebookPaymentSubmitting} className="w-full text-center text-slate-500 text-sm disabled:opacity-50">Cancel</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <PublicFooter />
    </div>
  )
}

export async function getStaticPaths() {
  const { data } = await supabase.rpc('get_public_properties')

  return {
    paths: (data || []).map(property => ({ params: { id: property.slug || property.id } })),
    fallback: 'blocking',
  }
}

export async function getStaticProps({ params }) {
  const propertyId = params?.id
  const usesUuid = UUID_PATTERN.test(String(propertyId || ''))
  const propertyResult = await supabase
    .rpc('get_public_property_by_identifier', { p_identifier: String(propertyId || '') })
    .maybeSingle()

  if (propertyResult.error || !propertyResult.data) {
    return { notFound: true, revalidate: 60 }
  }

  if (usesUuid && propertyResult.data.slug) {
    return { redirect: { destination: propertyPublicPath(propertyResult.data), statusCode: 301 } }
  }

  const [resolvedRoomsResult, resolvedSettingsResult] = await Promise.all([
    fetchPublicPropertyRooms(supabase, propertyResult.data.id),
      supabase.from('owner_settings').select('upi_id, upi_phone, advance_months, joining_fee, pre_booking_fee, application_deposit').eq('property_id', propertyResult.data.id).maybeSingle(),
  ])

  if (resolvedRoomsResult.error) throw resolvedRoomsResult.error

  let similarProperties = []
  if (propertyResult.data.city) {
    const { data } = await supabase
      .rpc('get_public_properties')
    similarProperties = (data || [])
      .filter(property => property.city === propertyResult.data.city && property.id !== propertyResult.data.id)
      .slice(0, 4)
  }

  return {
    props: {
      initialProperty: propertyResult.data,
      initialRooms: resolvedRoomsResult.data || [],
      initialSettings: resolvedSettingsResult.error ? null : resolvedSettingsResult.data,
      similarProperties,
    },
    revalidate: 300,
  }
}

