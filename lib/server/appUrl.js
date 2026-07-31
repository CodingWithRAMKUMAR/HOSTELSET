const DEFAULT_APP_URL = 'https://www.hostelset.com'

export function getAppUrl() {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '')
    .trim()
    .replace(/\/+$/, '')

  if (!configured || configured === 'https://hostelset.com') {
    return DEFAULT_APP_URL
  }

  return configured
}

export function getResetPasswordUrl() {
  return `${getAppUrl()}/reset-password`
}

export function getLoginUrl() {
  return `${getAppUrl()}/login`
}
