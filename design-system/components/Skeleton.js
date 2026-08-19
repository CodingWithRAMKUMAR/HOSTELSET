export function Skeleton({ className = '' }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-slate-200 ${className}`} />
}

export function DashboardSkeleton({ cards = 8 }) {
  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8" aria-busy="true" aria-label="Loading dashboard"><div className="mx-auto max-w-7xl"><Skeleton className="mb-8 h-16 w-full rounded-2xl"/><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: cards }, (_, index) => <div key={index} className="rounded-2xl border border-slate-100 bg-white p-4"><Skeleton className="mb-4 h-10 w-10 rounded-full"/><Skeleton className="mb-2 h-3 w-24"/><Skeleton className="h-7 w-16"/></div>)}</div><div className="mt-8 grid gap-6 md:grid-cols-2"><Skeleton className="h-64 rounded-2xl"/><Skeleton className="h-64 rounded-2xl"/></div></div></main>
}

export function TableSkeletonRows({ columns, rows = 4 }) {
  return Array.from({ length: rows }, (_, row) => <tr key={row} aria-hidden="true">{Array.from({ length: columns }, (_, column) => <td key={column} className="px-6 py-4"><Skeleton className="h-4 w-full max-w-32"/></td>)}</tr>)
}
