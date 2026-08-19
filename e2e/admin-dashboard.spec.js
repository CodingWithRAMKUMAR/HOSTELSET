import { test, expect } from '@playwright/test'
import {
  signInAs,
  verifyWrongRoleRedirect,
} from './authenticated-role-helper'

test('admin signs in and reaches only the admin dashboard', async ({
  page,
}) => {
  await signInAs(
    page,
    'admin',
    'qa.admin.active@example.test'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Platform management',
      exact: true,
    })
  ).toBeVisible()

  await verifyWrongRoleRedirect(
    page,
    '/owner/dashboard',
    '/admin/dashboard'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Platform management',
      exact: true,
    })
  ).toBeVisible()
})
