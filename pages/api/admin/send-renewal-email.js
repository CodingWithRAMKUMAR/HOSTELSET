import { supabaseAdmin } from '../../../lib/server/supabaseAdmin';
import { fetchWithTimeout } from '../../../lib/fetchWithTimeout';
import { logger } from '../../../lib/logger';
import { attachRequestContext } from '../../../lib/server/requestContext';
import { attachRequestTelemetry } from '../../../lib/server/requestTelemetry';
import { setPrivateApiResponse } from '../../../lib/server/publicApiSecurity';

const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

export default async function handler(req, res) {
  setPrivateApiResponse(res);
  const requestId = attachRequestContext(req, res);

  attachRequestTelemetry(req, res, {
    route: '/api/admin/send-renewal-email',
    requestId,
    reportServerErrors: false,
  });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin) return res.status(500).json({ error: 'Server is not configured' });

  const { ownerId } = req.body;
  if (!ownerId) return res.status(400).json({ error: 'Owner ID is required' });

  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Invalid session' });
    const { data: admin } = await supabaseAdmin.from('users').select('role, is_active').eq('id', user.id).single();
    if (admin?.role !== 'admin' || !admin?.is_active) return res.status(403).json({ error: 'Forbidden' });

    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('users')
      .select('email, full_name')
      .eq('id', ownerId)
      .eq('role', 'owner')
      .single();
    if (ownerError || !owner?.email) return res.status(404).json({ error: 'Owner not found' });

    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) return res.status(500).json({ error: 'Email service is not configured' });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hostelset.com';
    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2>HostelSet Membership Renewal Reminder</h2>
        <p>Hello ${escapeHtml(owner.full_name || 'Owner')},</p>
        <p>Your HostelSet membership is about to expire. Renew now to keep your property active and visible to tenants.</p>
        <p style="margin:30px 0"><a href="${escapeHtml(appUrl)}/owner/subscribe" style="background:#ea580c;color:white;padding:12px 20px;text-decoration:none;border-radius:6px">Renew Membership</a></p>
        <p>Thank you for choosing HostelSet.</p>
      </div>`;

    const response = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoApiKey },
      body: JSON.stringify({
        sender: { name: 'HostelSet', email: 'noreply@hostelset.com' },
        to: [{ email: owner.email, name: owner.full_name || 'Owner' }],
        subject: 'HostelSet Membership Renewal Reminder',
        htmlContent: emailHtml,
      }),
    }, 10000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Email service error (${response.status})`);
    return res.status(200).json({ success: true, message: 'Renewal email sent successfully' });
  } catch (error) {
    logger.error('Renewal email failed', error, { route: '/api/admin/send-renewal-email', requestId });
    const message = process.env.NODE_ENV === 'production'
      ? 'Unable to send renewal email'
      : error.message;
    return res.status(500).json({ success: false, error: message });
  }
}
