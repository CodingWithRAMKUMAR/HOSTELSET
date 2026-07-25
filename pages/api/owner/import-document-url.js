import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { allowPostOnly, requireJson, setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { logger } from '../../../lib/logger'
import { attachRequestContext } from '../../../lib/server/requestContext'
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry'
import { normalizePrivateDocumentPath } from '../../../lib/privateDocument'

const COOKIE_NAME = 'hostelset_access_token'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DOCUMENT_FIELDS = { id_proof: 'id_proof', photo: 'profile_photo' }
const DOCUMENT_PREFIXES = { id_proof: 'identity', photo: 'photos' }
const BUCKET = 'tenant-documents'

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';')
  const match = cookies.map(item => item.trim()).find(item => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

function logDocumentUnavailable(importId, documentType, category) {
  logger.info('Existing tenant import document unavailable', { importId, documentType, category })
}

async function objectExists(objectPath) {
  const split = objectPath.lastIndexOf('/')
  if (split <= 0) return false
  const folder = objectPath.slice(0, split)
  const name = objectPath.slice(split + 1)
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(folder, { search: name, limit: 2 })
  if (error) return false
  return Boolean(data?.some(item => item.name === name))
}

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  const requestId = attachRequestContext(req, res)

  attachRequestTelemetry(req, res, {
    route: '/api/owner/import-document-url',
    requestId,
    reportServerErrors: false,
  })
  if (!allowPostOnly(req, res) || !requireJson(req, res)) return
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Document service is unavailable' })

    const token = readCookie(req, COOKIE_NAME) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token || token.length > 8192) return res.status(401).json({ error: 'Authentication required' })
    const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !auth?.user) return res.status(401).json({ error: 'Authentication required' })

    const { importId } = req.body || {}
    const documentType = String(req.body?.documentType || req.body?.field || '')
    const storageField = DOCUMENT_FIELDS[documentType]
    if (!UUID.test(String(importId || ''))) return res.status(400).json({ error: 'Invalid document request' })
    if (!storageField) return res.status(400).json({ error: 'Invalid document type' })

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('role,is_active')
      .eq('id', auth.user.id)
      .single()
    if (profileError || !profile?.is_active || !['owner', 'admin'].includes(profile.role)) return res.status(403).json({ error: 'Not authorized' })

    const { data: importRecord, error: importError } = await supabaseAdmin
      .from('existing_tenant_imports')
      .select('id,property_id,status,id_proof,profile_photo')
      .eq('id', importId)
      .is('deleted_at', null)
      .single()
    if (importError || !importRecord) {
      logDocumentUnavailable(importId, documentType, 'record_absent')
      return res.status(404).json({ error: 'Document not found' })
    }

    if (profile.role !== 'admin') {
      const { data: property, error: propertyError } = await supabaseAdmin
        .from('properties')
        .select('owner_id')
        .eq('id', importRecord.property_id)
        .single()
      if (propertyError || property?.owner_id !== auth.user.id) return res.status(403).json({ error: 'Not authorized' })
    }

    const objectPath = normalizePrivateDocumentPath(importRecord[storageField], {
      bucket: BUCKET,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    })
    const expectedPrefix = `${importRecord.property_id}/imports/${DOCUMENT_PREFIXES[documentType]}/`
    if (!objectPath || !objectPath.startsWith(expectedPrefix)) {
      logDocumentUnavailable(importId, documentType, objectPath ? 'invalid_path' : 'path_absent')
      return res.status(404).json({ error: 'Document not found' })
    }

    if (!await objectExists(objectPath)) {
      logDocumentUnavailable(importId, documentType, 'object_absent')
      return res.status(404).json({ error: 'Document not found' })
    }

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(objectPath, 300)
    if (error || !data?.signedUrl) throw error || new Error('Signed URL was not returned')
    return res.status(200).json({ signedUrl: data.signedUrl })
  } catch (error) {
    logger.error('Existing tenant import document signing failed', error, { route: '/api/owner/import-document-url', requestId })
    return res.status(500).json({ error: 'Unable to open document. Please try again.' })
  }
}
