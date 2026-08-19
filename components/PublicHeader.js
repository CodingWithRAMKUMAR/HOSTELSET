import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BrandLogo from './BrandLogo'

const LOGIN_OPTIONS = [
  { label: 'Tenant Login', href: '/login/tenant' },
  { label: 'Owner Login', href: '/login/owner' },
  { label: 'Admin Login', href: '/login/admin' },
]

function LoginMenuLinks({ onClose, dark }) {
  return LOGIN_OPTIONS.map(option => (
    <Link
      key={option.href}
      role="menuitem"
      onClick={onClose}
      href={option.href}
      className={`block rounded-xl px-3 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 lg:py-2.5 ${dark ? 'text-slate-100 hover:bg-white/10' : 'text-slate-700 hover:bg-orange-50 hover:text-orange-700'}`}
    >
      {option.label}
    </Link>
  ))
}

function handleMenuKeyDown(event) {
  const items = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]'))
  const currentIndex = items.indexOf(document.activeElement)

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    items[(currentIndex + 1 + items.length) % items.length]?.focus()
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    items[(currentIndex - 1 + items.length) % items.length]?.focus()
  }

  if (event.key === 'Home') {
    event.preventDefault()
    items[0]?.focus()
  }

  if (event.key === 'End') {
    event.preventDefault()
    items[items.length - 1]?.focus()
  }
}

function LoginChooser({ open, onClose, dark, desktop = false }) {
  if (!open) return null

  const tone = dark
    ? 'border-white/10 bg-slate-900/95 shadow-black/30'
    : 'border-slate-200 bg-white shadow-slate-200/80'
  const placement = desktop
    ? 'absolute right-0 top-[calc(100%+0.75rem)] z-[140] hidden w-60 lg:grid'
    : 'mb-3 ml-auto mr-3 grid w-[calc(100%_-_1.5rem)] max-w-md lg:hidden'

  return (
    <div
      role="menu"
      aria-label="Login options"
      onKeyDown={handleMenuKeyDown}
      className={`${placement} gap-1 rounded-2xl border p-2 shadow-2xl ${tone}`}
    >
      <LoginMenuLinks onClose={onClose} dark={dark} />
    </div>
  )
}

export default function PublicHeader({ dark = true, floating = false, showNav = true, showAuth = true }) {
  const [loginOpen, setLoginOpen] = useState(false)
  const loginRef = useRef(null)

  useEffect(() => {
    if (!loginOpen) return undefined
    const close = event => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !loginRef.current?.contains(event.target))) {
        setLoginOpen(false)
      }
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [loginOpen])

  const shell = dark
    ? floating
      ? 'relative z-[130] border border-white/10 bg-white/[0.04] text-white backdrop-blur'
      : 'relative z-[130] border-b border-white/10 bg-slate-950 text-white'
    : 'relative z-[130] border-b border-slate-200 bg-white text-slate-900'
  const inner = floating
    ? 'relative z-[100] grid grid-cols-[auto_auto] items-center justify-between gap-3 overflow-visible rounded-3xl px-3 py-2.5 sm:rounded-full sm:px-4 sm:py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]'
    : 'mx-auto grid w-full max-w-7xl grid-cols-[auto_auto] items-center justify-between gap-3 overflow-visible px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:px-8'
  const navClass = dark
    ? 'text-slate-300 hover:text-white'
    : 'text-slate-600 hover:text-slate-950'
  const loginButton = dark
    ? 'public-login-button rounded-full px-4 py-2 text-sm font-black shadow-lg shadow-black/20 transition'
    : 'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-900 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700'

  return (
    <header className={shell}>
      <div ref={loginRef} className="relative">
      <div className={inner}>
        <Link href="/" aria-label="HostelSet home" className="shrink-0">
          <BrandLogo priority />
        </Link>
        {showNav && (
          <nav className="hidden min-w-0 items-center justify-center gap-4 text-sm font-semibold xl:gap-5 lg:flex" aria-label="Public navigation">
            <Link href="/" className={navClass}>Home</Link>
            <Link href="/properties" className={navClass}>Browse Hostels</Link>
            <Link href="/#for-tenants" className={navClass}>For Tenants</Link>
            <Link href="/#for-owners" className={navClass}>For Owners</Link>
            <Link href="/faq" className={navClass}>FAQ</Link>
          </nav>
        )}
        {showAuth && (
          <div className="relative justify-self-end">
            <button
              type="button"
              onClick={() => setLoginOpen(open => !open)}
              className={loginButton}
              aria-expanded={loginOpen}
              aria-haspopup="menu"
            >
              Login
            </button>
            <LoginChooser open={loginOpen} onClose={() => setLoginOpen(false)} dark={dark} desktop />
          </div>
        )}
      </div>
      {showAuth && <LoginChooser open={loginOpen} onClose={() => setLoginOpen(false)} dark={dark} />}
      </div>
    </header>
  )
}
