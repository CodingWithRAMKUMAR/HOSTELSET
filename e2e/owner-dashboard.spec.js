import { test, expect } from '@playwright/test'
import {
  signInAs,
  verifyWrongRoleRedirect,
} from './authenticated-role-helper'

test('owner signs in and loads the seeded property workspace', async ({
  page,
}) => {
  await signInAs(
    page,
    'owner',
    'qa.owner.a@example.test'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Quick actions',
      exact: true,
    })
  ).toBeVisible()

  await expect(
    page.getByRole('button', {
      name: '+ Add Tenant',
      exact: true,
    })
  ).toBeEnabled()

  await verifyWrongRoleRedirect(
    page,
    '/admin/dashboard',
    '/owner/dashboard'
  )

  await expect(
    page.getByRole('heading', {
      name: 'Quick actions',
      exact: true,
    })
  ).toBeVisible()
})
