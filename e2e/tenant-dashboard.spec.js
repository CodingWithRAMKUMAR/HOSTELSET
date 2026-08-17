import { test, expect } from '@playwright/test'
import {
  signInAs,
  verifyWrongRoleRedirect,
} from './authenticated-role-helper'

test('tenant signs in and loads the seeded rent dashboard', async ({
  page,
}) => {
  await signInAs(
    page,
    'tenant',
    'qa.tenant.a@example.test'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Account summary',
      exact: true,
    })
  ).toBeVisible()

  await expect(
    page.getByText('Monthly Rent', {
      exact: true,
    })
  ).toBeVisible()

  await verifyWrongRoleRedirect(
    page,
    '/owner/dashboard',
    '/tenant/dashboard'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Account summary',
      exact: true,
    })
  ).toBeVisible()
})
