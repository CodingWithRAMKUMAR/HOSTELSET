const { test, expect } = require('@playwright/test')

const testProperties = [
  {
    id: 'property-test-1',
    slug: 'sunrise-pg',
    name: 'Sunrise PG',
    city: 'Hyderabad',
    photos: [],
    latitude: 17.385,
    longitude: 78.4867,
    total_rooms: 10,
    available_room_count: 3,
    active_tenant_count: 7,
    lowest_rent: 6500,
  },
  {
    id: 'property-test-2',
    slug: 'green-hostel',
    name: 'Green Hostel',
    city: 'Warangal',
    photos: [],
    latitude: 17.9689,
    longitude: 79.5941,
    total_rooms: 8,
    available_room_count: 0,
    active_tenant_count: 8,
    lowest_rent: 5000,
  },
]

test.describe('Visitor — Browse Properties', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/public/properties', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(testProperties),
      })
    })

    await page.goto('/properties')
  })

  test('loads the public properties page successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/Browse Hostels and PGs/i)

    await expect(
      page.getByRole('heading', {
        name: 'Find Your Perfect PG',
      }),
    ).toBeVisible()

    await expect(page.getByText('Sunrise PG')).toBeVisible()
    await expect(page.getByText('Green Hostel')).toBeVisible()
  })

  test('shows correct property availability information', async ({ page }) => {
    await expect(page.getByText('3 rooms with availability')).toBeVisible()
    await expect(page.getByText('Currently full')).toBeVisible()

    await expect(page.getByText('10 rooms')).toBeVisible()
    await expect(page.getByText('8 active tenants')).toBeVisible()
  })

  test('searches properties by property name', async ({ page }) => {
    const search = page.getByPlaceholder(
      'Search by property name or city...',
    )

    await search.fill('Sunrise')

    await expect(page.getByText('Sunrise PG')).toBeVisible()
    await expect(page.getByText('Green Hostel')).toBeHidden()
  })

  test('searches properties by city', async ({ page }) => {
    const search = page.getByPlaceholder(
      'Search by property name or city...',
    )

    await search.fill('Warangal')

    await expect(page.getByText('Green Hostel')).toBeVisible()
    await expect(page.getByText('Sunrise PG')).toBeHidden()
  })

  test('filters properties using the city dropdown', async ({ page }) => {
    await page.getByRole('combobox').selectOption('Hyderabad')

    await expect(page.getByText('Sunrise PG')).toBeVisible()
    await expect(page.getByText('Green Hostel')).toBeHidden()
  })

  test('shows an empty message when no property matches', async ({ page }) => {
    const search = page.getByPlaceholder(
      'Search by property name or city...',
    )

    await search.fill('Property That Does Not Exist')

    await expect(
      page.getByText('No hostels match these filters right now.'),
    ).toBeVisible()
  })

  test('provides a View Details link for every property', async ({ page }) => {
    const links = page.getByRole('link', {
      name: 'View Details',
    })

    await expect(links).toHaveCount(2)

    const firstHref = await links.first().getAttribute('href')

    expect(firstHref).toBeTruthy()
    expect(firstHref).not.toBe('#')
  })

  test('switches between list and map controls', async ({ page }) => {
    await expect(
      page.getByRole('button', {
        name: 'List',
        exact: true,
      }),
    ).toBeVisible()

    await expect(
      page.getByRole('button', {
        name: 'Map',
        exact: true,
      }),
    ).toBeVisible()

    await page.getByRole('button', {
      name: 'Map',
      exact: true,
    }).click()

    await expect(
      page.getByRole('button', {
        name: 'Map',
        exact: true,
      }),
    ).toBeVisible()
  })
})
