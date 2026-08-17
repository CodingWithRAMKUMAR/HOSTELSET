import { expect } from '@playwright/test'

const destinations = {
  admin: '/admin/dashboard',
  owner: '/owner/dashboard',
  tenant: '/tenant/dashboard',
}

export async function signInAs(page, role, email) {
  const password =
    process.env.HOSTELSET_LOCAL_E2E_PASSWORD

  if (!password) {
    throw new Error(
      'HOSTELSET_LOCAL_E2E_PASSWORD is required'
    )
  }

  const destination = destinations[role]

  if (!destination) {
    throw new Error('Unsupported QA role: ' + role)
  }

  await page.goto('/login/' + role)

  const identifier =
    page.locator('#login-identifier')
  const passwordInput =
    page.locator('#login-password')

  await expect(identifier).toBeVisible()
  await expect(passwordInput).toBeVisible()

  await identifier.fill(email)
  await passwordInput.fill(password)

  await Promise.all([
    page.waitForURL(
      url => url.pathname === destination,
      { timeout: 45_000 }
    ),
    page
      .getByRole('button', { name: /^Login/ })
      .click(),
  ])

  await expect(page).toHaveURL(
    new RegExp(destination + '$')
  )
}

export async function verifyWrongRoleRedirect(
  page,
  attemptedDestination,
  correctDestination
) {
  await page.goto(attemptedDestination)

  await expect(page).toHaveURL(
    new RegExp(correctDestination + '$'),
    { timeout: 30_000 }
  )
}
