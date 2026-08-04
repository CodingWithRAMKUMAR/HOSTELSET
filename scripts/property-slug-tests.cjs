const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const helperPath = path.join(root, 'lib', 'propertySlug.js')

function loadPropertySlug() {
  let source = fs.readFileSync(helperPath, 'utf8')

  const exportCount =
    (source.match(/export const /g) || []).length

  if (exportCount !== 3) {
    throw new Error(
      `Expected exactly three exported constants, found ${exportCount}`
    )
  }

  source = source.replace(/export const /g, 'const ')
  source += [
    '',
    'module.exports = {',
    '  UUID_PATTERN,',
    '  propertyPublicId,',
    '  propertyPublicPath,',
    '}',
    '',
  ].join('\n')

  const sandbox = {
    module: { exports: {} },
    exports: {},
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: helperPath })

  return sandbox.module.exports
}

const {
  UUID_PATTERN,
  propertyPublicId,
  propertyPublicPath,
} = loadPropertySlug()

for (const uuid of [
  '123e4567-e89b-12d3-8456-426614174000',
  '123e4567-e89b-22d3-9456-426614174000',
  '123e4567-e89b-32d3-a456-426614174000',
  '123e4567-e89b-42d3-b456-426614174000',
  '123e4567-e89b-52d3-8456-426614174000',
  '123E4567-E89B-42D3-A456-426614174000',
]) {
  assert.equal(
    UUID_PATTERN.test(uuid),
    true,
    `expected a valid UUID: ${uuid}`
  )
}

console.log('ok - UUID matching accepts supported canonical UUIDs')

for (const uuid of [
  '',
  '123e4567-e89b-42d3-a456-42661417400',
  '123e4567-e89b-42d3-a456-4266141740000',
  '123e4567-e89b-02d3-a456-426614174000',
  '123e4567-e89b-62d3-a456-426614174000',
  '123e4567-e89b-42d3-7456-426614174000',
  '123e4567-e89b-42d3-c456-426614174000',
  '123e4567-e89b-42d3-a456-42661417400g',
  '{123e4567-e89b-42d3-a456-426614174000}',
  ' 123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174000 ',
  '123e4567-e89b-42d3-a456-426614174000\n',
  '123e4567-e89b-42d3-a456-426614174000\r\n',
]) {
  assert.equal(
    UUID_PATTERN.test(uuid),
    false,
    `expected a malformed UUID to be rejected: ${JSON.stringify(uuid)}`
  )
}

console.log('ok - UUID matching rejects malformed and extended values')

const propertyId = '123e4567-e89b-42d3-a456-426614174000'
const slug = 'sunrise-hostel-hyderabad'
const slugProperty = {
  id: propertyId,
  slug,
  name: 'Sunrise Hostel',
}

assert.equal(propertyPublicId(slugProperty), slug)
assert.equal(
  propertyPublicPath(slugProperty),
  `/property/${slug}`
)
assert.deepEqual(slugProperty, {
  id: propertyId,
  slug,
  name: 'Sunrise Hostel',
})

console.log('ok - public property links prefer stable slugs')

for (const property of [
  { id: propertyId },
  { id: propertyId, slug: null },
  { id: propertyId, slug: '' },
]) {
  assert.equal(propertyPublicId(property), propertyId)
  assert.equal(
    propertyPublicPath(property),
    `/property/${propertyId}`
  )
}

console.log('ok - missing property slugs fall back to UUID routes')
console.log('Property slug helper tests passed')
