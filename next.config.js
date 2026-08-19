const isProduction = process.env.NODE_ENV === 'production'
const isVercelPreview = process.env.VERCEL_ENV === 'preview'

const manifestSrc = [
  "'self'",
  ...(isVercelPreview ? ['https://vercel.com'] : []),
].join(' ')

const supabaseHttpOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  } catch {
    return null
  }
})()

const supabaseWebSocketOrigin = supabaseHttpOrigin
  ? supabaseHttpOrigin.replace(/^http/, 'ws')
  : null

const supabaseImageHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  } catch {
    return null
  }
})()

const compact = (values) => values.filter(Boolean)

const optionalOrigin = (value) => {
  try { return value ? new URL(value).origin : null } catch { return null }
}

const sentryOrigin = optionalOrigin(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
const posthogOrigin = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? optionalOrigin(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com')
  : null
const analyticsEnabled = Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src ${compact(["'self'", "'unsafe-inline'", !isProduction && "'unsafe-eval'", analyticsEnabled && 'https://www.googletagmanager.com', posthogOrigin]).join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src ${compact(["'self'", 'data:', 'blob:', 'https://*.supabase.co', supabaseHttpOrigin, 'https://maps.geoapify.com']).join(' ')}`,
  `connect-src ${compact(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', supabaseHttpOrigin, supabaseWebSocketOrigin, 'https://api.geoapify.com', 'https://maps.geoapify.com', analyticsEnabled && 'https://www.google-analytics.com', analyticsEnabled && 'https://region1.google-analytics.com', sentryOrigin, posthogOrigin]).join(' ')}`,
  `media-src ${compact(["'self'", 'blob:', 'https://*.supabase.co', supabaseHttpOrigin]).join(' ')}`,
  "worker-src 'self' blob:",
  `manifest-src ${manifestSrc}`,
  "frame-src 'none'",
  isProduction && 'upgrade-insecure-requests',
].filter(Boolean).join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      ...(supabaseImageHost ? [{
        protocol: 'https',
        hostname: supabaseImageHost,
        pathname: '/storage/v1/object/public/**',
      }] : []),
    ],
  },
  ...(!isProduction ? { allowedDevOrigins: ['172.20.10.7'] } : {}),
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
