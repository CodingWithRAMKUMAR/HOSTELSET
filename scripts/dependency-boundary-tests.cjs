const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const JS_EXTENSIONS = ['.js', '.jsx', '.cjs', '.mjs']

function posixPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/')
}

function existingDirectory(name) {
  const absolute = path.join(ROOT, name)
  return fs.existsSync(absolute) ? absolute : null
}

function walk(directory) {
  if (!directory) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return JS_EXTENSIONS.includes(path.extname(entry.name)) ? [absolute] : []
  })
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function importSpecifiers(source) {
  const specs = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1])
  }
  return specs
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return specifier
  return path.resolve(path.dirname(fromFile), specifier).replace(/\\/g, '/')
}

function productNameForResolved(resolved) {
  const relative = path.isAbsolute(resolved)
    ? path.relative(ROOT, resolved).replace(/\\/g, '/')
    : resolved
  const match = relative.match(/(?:^|\/)products\/([^/]+)/)
  return match?.[1] || null
}

function fail(message, failures) {
  failures.push(message)
}

const platformFiles = walk(existingDirectory('platform'))
const productFiles = walk(existingDirectory('products'))
const sharedUiFiles = [
  ...walk(existingDirectory('design-system')),
  ...walk(path.join(ROOT, 'components', 'ui')),
]

const failures = []

for (const file of platformFiles) {
  const source = read(file)
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(file, specifier)
    if (String(resolved).includes('/products/') || /^products\//.test(specifier)) {
      fail(`${posixPath(file)} imports product internals via ${specifier}`, failures)
    }
  }
}

for (const file of productFiles) {
  const source = read(file)
  const currentProduct = productNameForResolved(file)
  for (const specifier of importSpecifiers(source)) {
    const resolvedProduct = productNameForResolved(resolveSpecifier(file, specifier))
    if (resolvedProduct && currentProduct && resolvedProduct !== currentProduct) {
      fail(`${posixPath(file)} imports ${resolvedProduct} from ${currentProduct} product via ${specifier}`, failures)
    }
    if (specifier === 'react' || specifier.startsWith('next/') || /\.css$/i.test(specifier)) {
      fail(`${posixPath(file)} imports UI/runtime dependency ${specifier}`, failures)
    }
  }
}

const productBrowserApiAllowlist = new Set([
  'products/hostels/public/listing.js',
])
for (const file of productFiles) {
  const relative = posixPath(file)
  if (productBrowserApiAllowlist.has(relative)) continue
  const source = read(file)
  if (/\b(window|document|localStorage|sessionStorage)\b/.test(source)) {
    fail(`${relative} uses browser globals outside the verified browse-cache owner`, failures)
  }
  if (/\bclassName=|<\s*[A-Z_a-z][\w.-]*(\s|>)/.test(source)) {
    fail(`${relative} contains JSX/UI markup inside product domain/application code`, failures)
  }
}

const sharedBusinessTerms = /\b(hostel|rent|tenant|complaint|notice|vacate|room\s+change|membership|supabase|rpc|property|owner|admin)\b/i
for (const file of sharedUiFiles) {
  const source = read(file)
  if (sharedBusinessTerms.test(source)) {
    fail(`${posixPath(file)} contains product/business-specific terms`, failures)
  }
  for (const specifier of importSpecifiers(source)) {
    if (specifier.includes('products/') || specifier.includes('lib/supabase') || specifier.includes('publicSupabase')) {
      fail(`${posixPath(file)} imports product/API internals via ${specifier}`, failures)
    }
  }
}

const ownerRoomUiFiles = walk(path.join(ROOT, 'components', 'owner')).filter(file =>
  read(file).includes('products/hostels/owner/rooms')
)
for (const file of ownerRoomUiFiles) {
  const source = read(file)
  if (/\.from\(['"]rooms['"]\)|\.rpc\(['"]update_owner_room['"]\)/.test(source)) {
    fail(`${posixPath(file)} bypasses products/hostels/owner/rooms.js for migrated room inventory mutations`, failures)
  }
}

assert.deepEqual(failures, [])
console.log('Dependency boundary tests passed')
