import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/server/supabaseAdmin'
import { setPrivateApiResponse } from '../../../lib/server/publicApiSecurity'
import { normalizeBloodGroup } from '../../../lib/bloodGroups'
import { logger } from '../../../lib/logger'

const MAX_PER_GROUP = 5

const safeTerm = value => String(value || '').trim().slice(0, 80).replace(/[%_,()]/g, '')

export default async function handler(req, res) {
  setPrivateApiResponse(res)
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }) }
  if (!supabaseAdmin) return res.status(503).json({ error: 'Search service is unavailable' })
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  const caller = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user) return res.status(401).json({ error: 'Session expired' })
  const { data: admin } = await supabaseAdmin.from('users').select('role,is_active').eq('id', auth.user.id).single()
  if (admin?.role !== 'admin' || !admin.is_active) return res.status(403).json({ error: 'Admin access required' })

  const q = safeTerm(req.query.q)
  if (!q) return res.status(200).json({ groups: {} })
  const like = `%${q}%`
  const bloodGroup = normalizeBloodGroup(q)
  const tenantFilter = [`name.ilike.${like}`, `phone.ilike.${like}`, `email.ilike.${like}`]
  const applicationFilter = [`name.ilike.${like}`, `phone.ilike.${like}`, `email.ilike.${like}`]
  const importFilter = [`full_name.ilike.${like}`, `phone.ilike.${like}`, `email.ilike.${like}`, `room_number.ilike.${like}`]
  const [{ data: matchingRooms }, { data: matchingProperties }] = await Promise.all([
    supabaseAdmin.from('rooms').select('id').ilike('room_number', like).limit(20),
    supabaseAdmin.from('properties').select('id').or(`name.ilike.${like},address.ilike.${like},city.ilike.${like},locality.ilike.${like}`).limit(20),
  ])
  const roomIds = (matchingRooms || []).map(item => item.id)
  const propertyIds = (matchingProperties || []).map(item => item.id)
  if (roomIds.length) { tenantFilter.push(`room_id.in.(${roomIds.join(',')})`); applicationFilter.push(`room_id.in.(${roomIds.join(',')})`); importFilter.push(`room_id.in.(${roomIds.join(',')})`) }
  if (propertyIds.length) { tenantFilter.push(`property_id.in.(${propertyIds.join(',')})`); applicationFilter.push(`property_id.in.(${propertyIds.join(',')})`); importFilter.push(`property_id.in.(${propertyIds.join(',')})`) }
  if (bloodGroup) { tenantFilter.push(`blood_group.eq.${bloodGroup}`); applicationFilter.push(`blood_group.eq.${bloodGroup}`); importFilter.push(`blood_group.eq.${bloodGroup}`) }

  const [tenants, owners, properties, applications, imports] = await Promise.all([
    supabaseAdmin.from('tenants').select('id,name,phone,email,blood_group,status,rooms(room_number),property:property_id(id,name,city,locality)').or(tenantFilter.join(',')).order('created_at', { ascending: false }).limit(MAX_PER_GROUP),
    supabaseAdmin.from('users').select('id,full_name,email,phone,is_active').eq('role', 'owner').or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).order('created_at', { ascending: false }).limit(MAX_PER_GROUP),
    supabaseAdmin.from('properties').select('id,name,address,city,locality,is_active,owner_id').or(`name.ilike.${like},address.ilike.${like},city.ilike.${like},locality.ilike.${like},contact_number.ilike.${like}`).order('created_at', { ascending: false }).limit(MAX_PER_GROUP),
    supabaseAdmin.from('applications').select('id,name,phone,email,blood_group,status,property_id,room_id,rooms(room_number),properties(name,city,locality)').or(applicationFilter.join(',')).order('created_at', { ascending: false }).limit(MAX_PER_GROUP),
    supabaseAdmin.from('existing_tenant_imports').select('id,full_name,phone,email,blood_group,status,property_id,room_id,room_number').or(importFilter.join(',')).order('created_at', { ascending: false }).limit(MAX_PER_GROUP),
  ])
  const failed = [tenants, owners, properties, applications, imports]
    .find(result => result.error)

  if (failed) {
    logger.error('Admin global search query failed', failed.error, {
      route: '/api/admin/global-search',
      queryLength: q.length,
    })

    return res.status(500).json({ error: 'Search failed' })
  }
  return res.status(200).json({ groups: { Tenants: tenants.data, Owners: owners.data, Properties: properties.data, Applications: applications.data, Imports: imports.data } })
}
