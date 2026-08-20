import Link from 'next/link'
import BrandLogo from './BrandLogo'

const footerGroups = [
  {
    id: 'tenants',
    title: 'For Tenants',
    links: [
      { id: 'tenant-browse', label: 'Browse Hostels', href: '/properties' },
      { id: 'tenant-how-it-works', label: 'How Applications Work', href: '/faq' },
      { id: 'tenant-login', label: 'Tenant Login', href: '/login/tenant' },
      { id: 'tenant-faq', label: 'FAQ', href: '/faq' },
    ],
  },
  {
    id: 'owners',
    title: 'For Owners',
    links: [
      { id: 'owner-register', label: 'Register Your Property', href: '/register' },
      { id: 'owner-login', label: 'Owner Login', href: '/login/owner' },
      { id: 'owner-features', label: 'Features for Owners', href: '/#for-owners' },
      { id: 'owner-support', label: 'Support', href: '/support' },
    ],
  },
  {
    id: 'company',
    title: 'Company / Legal',
    links: [
      { id: 'company-about', label: 'About', href: '/about' },
      { id: 'company-contact', label: 'Contact / Support', href: '/contact' },
      { id: 'company-privacy', label: 'Privacy Policy', href: '/privacy-policy' },
      { id: 'company-terms', label: 'Terms and Conditions', href: '/terms' },
      { id: 'company-faq', label: 'FAQ', href: '/faq' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin',
    links: [
      { id: 'admin-login', label: 'Admin Login', href: '/login/admin' },
    ],
  },
]

export default function PublicFooter({ dark = false }) {
  const year = new Date().getFullYear()
  const shell = dark ? 'border-t border-white/10 bg-slate-950 text-slate-300' : 'mt-12 border-t border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
  const muted = dark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
  const heading = dark ? 'text-white' : 'text-slate-900 dark:text-white'
  const linkClass = dark ? 'text-slate-400 hover:text-orange-200' : 'text-slate-600 hover:text-orange-700 dark:text-slate-400 dark:hover:text-orange-200'

  return (
    <footer className={`${shell} w-full overflow-hidden py-6 sm:py-10`}>
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))] lg:gap-8 lg:px-8">
        <div className="min-w-0">
          <Link href="/" aria-label="HostelSet home" className="inline-flex max-w-[150px]">
            <BrandLogo size="footer" />
          </Link>
          <p className={`mt-3 max-w-sm text-sm leading-6 ${muted}`}>
            HostelSet helps hostel owners manage rooms, tenants, rent, notices, and requests while helping tenants browse hostels and apply online.
          </p>
          <p className={`mt-4 text-xs ${muted}`}>© {year} HostelSet. All rights reserved.</p>
        </div>

        {footerGroups.map(group => (
          <nav key={group.id} aria-label={group.title} className="min-w-0">
            <h2 className={`text-sm font-black ${heading}`}>{group.title}</h2>
            <ul className="mt-2.5 space-y-2 text-sm sm:mt-3 sm:space-y-2.5">
              {group.links.map(link => (
                <li key={link.id}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  )
}
