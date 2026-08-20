import Head from 'next/head'
import Link from 'next/link'
import PublicFooter from './PublicFooter'
import PublicHeader from './PublicHeader'

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.hostelset.com').replace(/\/$/, '')
const SOCIAL_IMAGE = `${SITE_URL}/brand/logo-primary.png`

export default function PublicInfoPage({ title, description, path, children }) {
  return (
    <>
      <Head>
        <title>{title} - HostelSet</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${SITE_URL}${path}`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="HostelSet" />
        <meta property="og:title" content={`${title} - HostelSet`} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={`${SITE_URL}${path}`} />
        <meta property="og:image" content={SOCIAL_IMAGE} />
        <meta property="og:image:alt" content="HostelSet" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${title} - HostelSet`} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:url" content={`${SITE_URL}${path}`} />
        <meta name="twitter:image" content={SOCIAL_IMAGE} />
      </Head>
      <PublicHeader dark={false} />
      <main className="min-h-[calc(100vh-140px)] bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{title}</h1>
          <div className="mt-6 space-y-5 leading-7 text-slate-700 dark:text-slate-300">{children}</div>
          <nav className="mt-8 flex flex-wrap gap-4" aria-label="Public pages">
            <Link href="/" className="font-semibold text-orange-700 underline dark:text-orange-300">Home</Link>
            <Link href="/properties" className="font-semibold text-orange-700 underline dark:text-orange-300">Browse properties</Link>
          </nav>
          <p className="mt-8 border-t border-slate-200 pt-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">These pages provide general information and are not legal advice.</p>
        </article>
      </main>
      <PublicFooter />
    </>
  )
}
