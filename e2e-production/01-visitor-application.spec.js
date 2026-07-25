const { test, expect } = require('@playwright/test')
const { createClient } = require('@supabase/supabase-js')

const PROPERTY_PATH = '/property/testproperty1-dfa'

async function openApplicationForm(page) {
  const response = await page.goto(PROPERTY_PATH, {
    waitUntil: 'domcontentloaded',
  })

  expect(
    response,
    'The production property page should return a response'
  ).not.toBeNull()

  expect(
    response.status(),
    `The property page returned HTTP ${response.status()}`
  ).toBeLessThan(400)

  await expect(page).toHaveURL(
    /\/property\/testproperty1-dfa\/?$/
  )

  await expect(
    page.getByRole('tab', {
      name: /Rooms & Availability/i,
    })
  ).toBeVisible()

  await expect(
    page.getByRole('heading', {
      name: /^Room\s+/i,
    }).first()
  ).toBeVisible()

  const applyButton = page
    .getByRole('button', {
      name: /Apply for this Hostel/i,
    })
    .first()

  await expect(
    applyButton,
    'At least one room should be available'
  ).toBeVisible()

  await expect(applyButton).toBeEnabled()
  await applyButton.click()

  const applicationHeading = page.getByRole('heading', {
    name: 'Apply for this Hostel',
  })

  await expect(applicationHeading).toBeVisible()

  return applicationHeading
}

test.describe('Production visitor application flow', () => {
  test(
    'opens the application form and validates empty required fields',
    async ({ page }) => {
      const applicationHeading =
        await openApplicationForm(page)

      const fullName =
        page.getByPlaceholder('Full Name *')

      const phone =
        page.getByPlaceholder('Phone Number *')

      const email =
        page.getByPlaceholder(
          'Email * (will be used for login)'
        )

      const bloodGroup = page
        .locator('select')
        .filter({
          has: page.locator(
            'option[value=""]'
          ),
        })
        .first()

      const message =
        page.getByPlaceholder(
          'Any message for the owner?'
        )

      const consent =
        page.locator('#applicationPolicyConsent')

      const continueButton =
        page.getByRole('button', {
          name: 'Continue to Payment',
        })

      await expect(fullName).toBeVisible()
      await expect(phone).toBeVisible()
      await expect(email).toBeVisible()
      await expect(bloodGroup).toBeVisible()
      await expect(message).toBeVisible()
      await expect(consent).toBeVisible()

      const fileInputs =
        page.locator('input[type="file"]')

      await expect(fileInputs).toHaveCount(2)

      await expect(
        continueButton,
        'Continue must remain disabled while required fields are empty'
      ).toBeDisabled()

      await expect(
        page
          .getByRole('link', {
            name: 'Privacy Policy',
          })
          .first()
      ).toBeVisible()

      await expect(
        page
          .getByRole('link', {
            name: 'Terms & Conditions',
          })
          .first()
      ).toBeVisible()

      await page
        .getByRole('button', {
          name: '✕',
        })
        .click()

      await expect(applicationHeading).toBeHidden()
    }
  )

  test(
    'fills applicant details but does not upload or submit',
    async ({ page }) => {
      const applicationHeading =
        await openApplicationForm(page)

      const testName = 'HostelSet E2E Applicant'
      const testPhone = '9876504321'
      const testEmail =
        `hostelset.e2e.${Date.now()}@example.com`
      const testMessage =
        'Automated production validation only. No submission.'

      const fullName =
        page.getByPlaceholder('Full Name *')

      const phone =
        page.getByPlaceholder('Phone Number *')

      const email =
        page.getByPlaceholder(
          'Email * (will be used for login)'
        )

      const bloodGroup = page
        .locator('select')
        .filter({
          has: page.locator(
            'option[value=""]'
          ),
        })
        .first()

      const message =
        page.getByPlaceholder(
          'Any message for the owner?'
        )

      const consent =
        page.locator('#applicationPolicyConsent')

      const continueButton =
        page.getByRole('button', {
          name: 'Continue to Payment',
        })

      await fullName.fill(testName)
      await phone.fill(testPhone)
      await email.fill(testEmail)
      await bloodGroup.selectOption('O+')
      await message.fill(testMessage)
      await consent.check()

      await expect(fullName).toHaveValue(testName)
      await expect(phone).toHaveValue(testPhone)
      await expect(email).toHaveValue(testEmail)
      await expect(bloodGroup).toHaveValue('O+')
      await expect(message).toHaveValue(testMessage)
      await expect(consent).toBeChecked()

      // Trigger the production phone and email blur checks.
      await message.click()

      await expect(
        page.getByText('Checking...').first()
      ).toBeHidden({
        timeout: 15_000,
      })

      const fileInputs =
        page.locator('input[type="file"]')

      await expect(fileInputs).toHaveCount(2)

      await expect(
        continueButton,
        'Continue must remain disabled because ID proof and photo are missing'
      ).toBeDisabled()

      await expect(
        page.getByRole('heading', {
          name: /Application.*Payment/i,
        })
      ).toHaveCount(0)

      await page
        .getByRole('button', {
          name: '✕',
        })
        .click()

      await expect(applicationHeading).toBeHidden()
    }
  )
  test(
    'uploads temporary documents and enables Continue without proceeding',
    async ({ page }) => {
      const applicationHeading =
        await openApplicationForm(page)

      const uniqueValue = Date.now()

      const testName = 'HostelSet E2E Upload Test'
      const testPhone = '9876504321'
      const testEmail =
        `hostelset.e2e.upload.${uniqueValue}@example.com`
      const testMessage =
        'Automated file-selection validation only. No submission.'

      const fullName =
        page.getByPlaceholder('Full Name *')

      const phone =
        page.getByPlaceholder('Phone Number *')

      const email =
        page.getByPlaceholder(
          'Email * (will be used for login)'
        )

      const bloodGroup = page
        .locator('select')
        .filter({
          has: page.locator(
            'option[value=""]'
          ),
        })
        .first()

      const message =
        page.getByPlaceholder(
          'Any message for the owner?'
        )

      const consent =
        page.locator('#applicationPolicyConsent')

      const continueButton =
        page.getByRole('button', {
          name: 'Continue to Payment',
        })

      const idProofInput =
        page.locator(
          'input[type="file"][accept="image/*,.pdf"]'
        )

      const photoInput =
        page.locator(
          'input[type="file"][accept="image/*"]'
        )

      await fullName.fill(testName)
      await phone.fill(testPhone)
      await email.fill(testEmail)
      await bloodGroup.selectOption('O+')
      await message.fill(testMessage)
      await consent.check()

      // Trigger phone and email blur validation.
      await message.click()

      await expect(
        page.getByText('Checking...').first()
      ).toBeHidden({
        timeout: 15_000,
      })

      await expect(idProofInput).toHaveCount(1)
      await expect(photoInput).toHaveCount(1)

      await expect(
        continueButton,
        'Continue must remain disabled before both files are selected'
      ).toBeDisabled()

      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' +
        'CAQAAAC1HAwCAAAAC0lEQVR42mP8/x8A' +
        'AukB9p8n7iAAAAAASUVORK5CYII=',
        'base64'
      )

      await idProofInput.setInputFiles({
        name: 'hostelset-e2e-id-proof.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      })

      await photoInput.setInputFiles({
        name: 'hostelset-e2e-photo.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      })

      await expect(idProofInput).toHaveValue(
        /hostelset-e2e-id-proof\.png$/
      )

      await expect(photoInput).toHaveValue(
        /hostelset-e2e-photo\.png$/
      )

      await expect(
        page.getByAltText(
          'Selected profile photo preview'
        )
      ).toBeVisible()

      await expect(
        continueButton,
        'Continue should become enabled after all required details and files are provided'
      ).toBeEnabled({
        timeout: 15_000,
      })

      // Safety assertion: do not click Continue to Payment.
      await expect(
        page.getByRole('heading', {
          name: /Application.*Payment/i,
        })
      ).toHaveCount(0)

      await page
        .getByRole('button', {
          name: '✕',
        })
        .click()

      await expect(applicationHeading).toBeHidden()
    }
  )
  test(
    'visually opens and validates the application payment modal',
    async ({ page }) => {
      test.setTimeout(90_000)

      const visualStep = async (message, delay = 900) => {
        console.log(`\n✓ ${message}`)
        await page.waitForTimeout(delay)
      }

      console.log(
        '\n========================================'
      )
      console.log(
        'STEP 4 - APPLICATION PAYMENT MODAL'
      )
      console.log(
        '========================================'
      )

      await visualStep(
        'Opening the production property...'
      )

      const applicationHeading =
        await openApplicationForm(page)

      await visualStep(
        'Application form opened.'
      )

      const uniqueValue = Date.now()

      const fullName =
        page.getByPlaceholder('Full Name *')

      const phone =
        page.getByPlaceholder('Phone Number *')

      const email =
        page.getByPlaceholder(
          'Email * (will be used for login)'
        )

      const bloodGroup = page
        .locator('select')
        .filter({
          has: page.locator(
            'option[value=""]'
          ),
        })
        .first()

      const message =
        page.getByPlaceholder(
          'Any message for the owner?'
        )

      const consent =
        page.locator('#applicationPolicyConsent')

      const continueButton =
        page.getByRole('button', {
          name: 'Continue to Payment',
        })

      const idProofInput =
        page.locator(
          'input[type="file"][accept="image/*,.pdf"]'
        )

      const photoInput =
        page.locator(
          'input[type="file"][accept="image/*"]'
        )

      await visualStep(
        'Filling applicant name...'
      )

      await fullName.pressSequentially(
        'HostelSet Visual E2E Applicant',
        { delay: 45 }
      )

      await visualStep(
        'Filling phone number...'
      )

      await phone.pressSequentially(
        '9876504321',
        { delay: 70 }
      )

      await visualStep(
        'Filling applicant email...'
      )

      await email.pressSequentially(
        `hostelset.visual.${uniqueValue}@example.com`,
        { delay: 30 }
      )

      await visualStep(
        'Selecting blood group...'
      )

      await bloodGroup.selectOption('O+')

      await visualStep(
        'Typing the test message...'
      )

      await message.pressSequentially(
        'Visual production test only. No application will be submitted.',
        { delay: 20 }
      )

      await visualStep(
        'Accepting Privacy Policy and Terms...'
      )

      await consent.check()

      await expect(consent).toBeChecked()

      await visualStep(
        'Waiting for phone and email validation...',
        1500
      )

      await expect(
        page.getByText('Checking...').first()
      ).toBeHidden({
        timeout: 15_000,
      })

      await expect(idProofInput).toHaveCount(1)
      await expect(photoInput).toHaveCount(1)

      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' +
        'CAQAAAC1HAwCAAAAC0lEQVR42mP8/x8A' +
        'AukB9p8n7iAAAAAASUVORK5CYII=',
        'base64'
      )

      await visualStep(
        'Attaching temporary test ID proof...'
      )

      await idProofInput.setInputFiles({
        name: 'hostelset-visual-id-proof.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      })

      await visualStep(
        'Attaching temporary passport photo...'
      )

      await photoInput.setInputFiles({
        name: 'hostelset-visual-photo.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      })

      await expect(
        page.getByAltText(
          'Selected profile photo preview'
        )
      ).toBeVisible()

      await visualStep(
        'Passport photo preview is visible.'
      )

      await expect(
        continueButton,
        'Continue should become enabled after completing the form'
      ).toBeEnabled({
        timeout: 15_000,
      })

      await visualStep(
        'Continue to Payment is enabled.'
      )

      await visualStep(
        'Clicking Continue to Payment...'
      )

      await continueButton.click()

      const paymentSubmitButton =
        page.getByRole('button', {
          name: /I Have Paid/i,
        })

      const paymentNotice =
        page.getByText(
          /After payment, your application will be submitted/i
        )

      const fakePaymentWarning =
        page.getByText(
          /Submitting fake payment proof/i
        )

      await expect(
        paymentSubmitButton
      ).toBeVisible({
        timeout: 15_000,
      })

      await visualStep(
        'Application payment modal opened.',
        1200
      )

      await expect(paymentNotice).toBeVisible()
      await expect(fakePaymentWarning).toBeVisible()

      await visualStep(
        'Payment instructions are visible.'
      )

      await expect(
        paymentSubmitButton
      ).not.toHaveText(/Processing/i)

      await visualStep(
        'Payment submission button is visible, but it will not be clicked.'
      )

      const cancelButton =
        page.getByRole('button', {
          name: 'Cancel',
        })

      await expect(cancelButton).toBeVisible()

      await visualStep(
        'Closing the payment modal safely...'
      )

      await cancelButton.click()

      await expect(paymentSubmitButton).toBeHidden()

      await visualStep(
        'Payment modal closed. Nothing was submitted.'
      )

      await expect(
        applicationHeading,
        'Cancel should close the payment modal and application form'
      ).toHaveCount(0)

      await visualStep(
        'Application form also closed safely.'
      )

      await visualStep(
        'Step 4 completed successfully.'
      )
    }
  )
  test(
    'visually fills payment proof without submitting',
    async ({ page }) => {
      test.setTimeout(120_000)

      let uploadApiCalls = 0
      let submissionApiCalls = 0

      page.on('request', request => {
        const url = request.url()

        if (url.includes('/api/visitor/upload-url')) {
          uploadApiCalls += 1
        }

        if (url.includes('/api/visitor/submit')) {
          submissionApiCalls += 1
        }
      })

      const visualStep = async (
        message,
        delay = 900
      ) => {
        console.log(`\n✓ ${message}`)
        await page.waitForTimeout(delay)
      }

      console.log(
        '\n========================================'
      )
      console.log(
        'STEP 5 - PAYMENT PROOF VALIDATION'
      )
      console.log(
        '========================================'
      )

      await visualStep(
        'Opening the production property...'
      )

      await openApplicationForm(page)

      await visualStep(
        'Application form opened.'
      )

      const uniqueValue = Date.now()

      const fullName =
        page.getByPlaceholder('Full Name *')

      const phone =
        page.getByPlaceholder('Phone Number *')

      const email =
        page.getByPlaceholder(
          'Email * (will be used for login)'
        )

      const bloodGroup = page
        .locator('select')
        .filter({
          has: page.locator(
            'option[value=""]'
          ),
        })
        .first()

      const message =
        page.getByPlaceholder(
          'Any message for the owner?'
        )

      const consent =
        page.locator('#applicationPolicyConsent')

      const continueButton =
        page.getByRole('button', {
          name: 'Continue to Payment',
        })

      const applicationFileInputs =
        page.locator('input[type="file"]')

      await visualStep(
        'Typing applicant name...'
      )

      await fullName.pressSequentially(
        'HostelSet Payment Validation Test',
        { delay: 35 }
      )

      await visualStep(
        'Typing phone number...'
      )

      await phone.pressSequentially(
        '9876504321',
        { delay: 65 }
      )

      await visualStep(
        'Typing unique test email...'
      )

      await email.pressSequentially(
        `hostelset.payment.${uniqueValue}@example.com`,
        { delay: 25 }
      )

      await visualStep(
        'Selecting blood group...'
      )

      await bloodGroup.selectOption('O+')

      await visualStep(
        'Typing test message...'
      )

      await message.pressSequentially(
        'Payment proof field validation only. Nothing will be submitted.',
        { delay: 18 }
      )

      await visualStep(
        'Accepting Privacy Policy and Terms...'
      )

      await consent.check()
      await expect(consent).toBeChecked()

      await visualStep(
        'Waiting for phone and email checks...',
        1500
      )

      await expect(
        page.getByText('Checking...').first()
      ).toBeHidden({
        timeout: 15_000,
      })

      await expect(
        applicationFileInputs
      ).toHaveCount(2)

      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' +
        'CAQAAAC1HAwCAAAAC0lEQVR42mP8/x8A' +
        'AukB9p8n7iAAAAAASUVORK5CYII=',
        'base64'
      )

      await visualStep(
        'Selecting temporary ID proof...'
      )

      await applicationFileInputs
        .nth(0)
        .setInputFiles({
          name: 'hostelset-step5-id-proof.png',
          mimeType: 'image/png',
          buffer: tinyPng,
        })

      await visualStep(
        'Selecting temporary passport photo...'
      )

      await applicationFileInputs
        .nth(1)
        .setInputFiles({
          name: 'hostelset-step5-photo.png',
          mimeType: 'image/png',
          buffer: tinyPng,
        })

      await expect(
        page.getByAltText(
          'Selected profile photo preview'
        )
      ).toBeVisible()

      await expect(
        continueButton
      ).toBeEnabled({
        timeout: 15_000,
      })

      await visualStep(
        'Opening payment page...'
      )

      const identityResponses = []

      const captureIdentityResponse = async response => {
        if (
          !response.url().includes(
            '/api/visitor/check-identity'
          )
        ) {
          return
        }

        let responseBody = ''

        try {
          responseBody = await response.text()
        } catch {
          responseBody = '[response body unavailable]'
        }

        identityResponses.push({
          status: response.status(),
          url: response.url(),
          body: responseBody,
        })

        console.log(
          `\nIdentity check response: ${response.status()} ${responseBody}`
        )
      }

      page.on(
        'response',
        captureIdentityResponse
      )

      await continueButton.click()

      const paymentHeading =
        page.getByRole('heading', {
          name: 'Application / Security Deposit',
        })

      try {
        await expect(
          paymentHeading
        ).toBeVisible({
          timeout: 30_000,
        })
      } catch (error) {
        const visibleMessages = await page
          .locator(
            '[role="alert"], [role="status"], .go2072408551'
          )
          .allInnerTexts()
          .catch(() => [])

        console.log(
          '\nPayment modal did not open.'
        )

        console.log(
          '\nIdentity responses:',
          JSON.stringify(
            identityResponses,
            null,
            2
          )
        )

        console.log(
          '\nVisible alerts/toasts:',
          JSON.stringify(
            visibleMessages,
            null,
            2
          )
        )

        throw error
      } finally {
        page.off(
          'response',
          captureIdentityResponse
        )
      }

      await visualStep(
        'Payment page opened.'
      )

      const paymentModal =
        paymentHeading.locator('..')

      const transactionInput =
        paymentModal.locator(
          'input[type="text"]'
        )

      const paymentScreenshotInput =
        paymentModal.locator(
          'input[type="file"]'
        )

      const submitPaymentButton =
        paymentModal.getByRole('button', {
          name: /I Have Paid/i,
        })

      const cancelButton =
        paymentModal.getByRole('button', {
          name: 'Cancel',
        })

      await expect(
        transactionInput
      ).toHaveCount(1)

      await expect(
        paymentScreenshotInput
      ).toHaveCount(1)

      await expect(
        submitPaymentButton
      ).toBeVisible()

      const transactionId =
        `E2E-NOT-PAID-${uniqueValue}`

      await visualStep(
        'Typing a test transaction reference...'
      )

      await transactionInput.pressSequentially(
        transactionId,
        { delay: 45 }
      )

      await expect(
        transactionInput
      ).toHaveValue(transactionId)

      await visualStep(
        'Selecting temporary payment screenshot...'
      )

      await paymentScreenshotInput.setInputFiles({
        name: 'hostelset-step5-payment-proof.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      })

      await expect(
        paymentScreenshotInput
      ).toHaveValue(
        /hostelset-step5-payment-proof\.png$/
      )

      await visualStep(
        'Transaction reference and payment proof are visible.',
        1500
      )

      await expect(
        submitPaymentButton,
        'The final submission button should be available'
      ).toBeEnabled()

      await visualStep(
        'Final submission button is enabled, but it will not be clicked.',
        1600
      )

      expect(
        uploadApiCalls,
        'Selecting files must not upload them'
      ).toBe(0)

      expect(
        submissionApiCalls,
        'The application submission API must not be called'
      ).toBe(0)

      await visualStep(
        'Confirmed: no files were uploaded and no application was submitted.'
      )

      await visualStep(
        'Closing the payment flow safely...'
      )

      await cancelButton.click()

      await expect(paymentHeading).toHaveCount(0)

      expect(uploadApiCalls).toBe(0)
      expect(submissionApiCalls).toBe(0)

      await visualStep(
        'Step 5 completed successfully.'
      )
    }
  )
  test(
    'submits one real application, verifies it, and removes all test data',
    async ({ page }) => {
      test.setTimeout(180_000)

      console.log(
        '\n========================================'
      )
      console.log(
        'STEP 6 - REAL SUBMISSION WITH CLEANUP'
      )
      console.log(
        '========================================'
      )

      const supabaseUrl =
        process.env.NEXT_PUBLIC_SUPABASE_URL

      const serviceRoleKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY

      expect(
        supabaseUrl,
        'NEXT_PUBLIC_SUPABASE_URL must be available'
      ).toBeTruthy()

      expect(
        serviceRoleKey,
        'SUPABASE_SERVICE_ROLE_KEY must be available'
      ).toBeTruthy()

      const supabaseAdmin = createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )

      const uniqueValue = Date.now()
      const uniqueSuffix =
        String(uniqueValue).slice(-8)

      const testData = {
        name: `HostelSet Step 6 ${uniqueValue}`,
        phone: `97${uniqueSuffix}`,
        email:
          `hostelset.step6.${uniqueValue}@example.com`,
        bloodGroup: 'O+',
        message:
          'Automated production submission test. This application must be removed automatically.',
        transactionId:
          `HOSTELSET-E2E-${uniqueValue}`,
      }

      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' +
        'CAQAAAC1HAwCAAAAC0lEQVR42mP8/x8A' +
        'AukB9p8n7iAAAAAASUVORK5CYII=',
        'base64'
      )

      let application = null
      let notificationIds = []
      const uploadedPaths = new Set()
      const uploadUrlRequests = []
      const submitRequests = []
      const uploadResponseTasks = []

      page.on('request', request => {
        const url = request.url()

        if (
          url.includes('/api/visitor/upload-url')
        ) {
          uploadUrlRequests.push(request)
        }

        if (
          url.includes('/api/visitor/submit')
        ) {
          submitRequests.push(request)
        }
      })

      page.on('response', response => {
        if (
          !response.url().includes(
            '/api/visitor/upload-url'
          )
        ) {
          return
        }

        const task = (async () => {
          const body = await response
            .json()
            .catch(() => null)

          if (
            body &&
            typeof body.path === 'string'
          ) {
            uploadedPaths.add(body.path)
          }
        })()

        uploadResponseTasks.push(task)
      })

      const cleanupErrors = []

      try {
        console.log(
          '\n✓ Opening the production property...'
        )

        await openApplicationForm(page)

        const fullName =
          page.getByPlaceholder('Full Name *')

        const phone =
          page.getByPlaceholder('Phone Number *')

        const email =
          page.getByPlaceholder(
            'Email * (will be used for login)'
          )

        const bloodGroup = page
          .locator('select')
          .filter({
            has: page.locator(
              'option[value=""]'
            ),
          })
          .first()

        const message =
          page.getByPlaceholder(
            'Any message for the owner?'
          )

        const consent =
          page.locator(
            '#applicationPolicyConsent'
          )

        const continueButton =
          page.getByRole('button', {
            name: 'Continue to Payment',
          })

        const idProofInput =
          page.locator(
            'input[type="file"][accept="image/*,.pdf"]'
          )

        const photoInput =
          page.locator(
            'input[type="file"][accept="image/*"]'
          )

        console.log(
          '\n✓ Filling unique applicant details...'
        )

        await fullName.fill(testData.name)
        await phone.fill(testData.phone)
        await email.fill(testData.email)
        await bloodGroup.selectOption(
          testData.bloodGroup
        )
        await message.fill(testData.message)
        await consent.check()

        await message.click()

        await expect(
          page.getByText('Checking...').first()
        ).toBeHidden({
          timeout: 20_000,
        })

        await idProofInput.setInputFiles({
          name:
            `hostelset-step6-id-${uniqueValue}.png`,
          mimeType: 'image/png',
          buffer: tinyPng,
        })

        await photoInput.setInputFiles({
          name:
            `hostelset-step6-photo-${uniqueValue}.png`,
          mimeType: 'image/png',
          buffer: tinyPng,
        })

        await expect(
          page.getByAltText(
            'Selected profile photo preview'
          )
        ).toBeVisible()

        await expect(
          continueButton
        ).toBeEnabled({
          timeout: 20_000,
        })

        console.log(
          '\n✓ Opening the payment modal...'
        )

        await continueButton.click()

        const paymentHeading =
          page.getByRole('heading', {
            name:
              'Application / Security Deposit',
          })

        await expect(
          paymentHeading
        ).toBeVisible({
          timeout: 30_000,
        })

        const paymentModal =
          paymentHeading.locator('..')

        const transactionInput =
          paymentModal.locator(
            'input[type="text"]'
          )

        const paymentScreenshotInput =
          paymentModal.locator(
            'input[type="file"]'
          )

        const submitButton =
          paymentModal.getByRole('button', {
            name: /I Have Paid/i,
          })

        await transactionInput.fill(
          testData.transactionId
        )

        await paymentScreenshotInput
          .setInputFiles({
            name:
              `hostelset-step6-payment-${uniqueValue}.png`,
            mimeType: 'image/png',
            buffer: tinyPng,
          })

        await expect(
          submitButton
        ).toBeEnabled()

        console.log(
          '\n✓ Performing one real production submission...'
        )

        const submitResponsePromise =
          page.waitForResponse(
            response =>
              response.url().includes(
                '/api/visitor/submit'
              ) &&
              response.request().method() ===
                'POST',
            {
              timeout: 60_000,
            }
          )

        await submitButton.click()

        const submitResponse =
          await submitResponsePromise

        const submitBody =
          await submitResponse
            .json()
            .catch(() => null)

        expect(
          submitResponse.status(),
          `Submission response: ${JSON.stringify(
            submitBody
          )}`
        ).toBe(201)

        await Promise.all(
          uploadResponseTasks
        )

        expect(
          uploadUrlRequests.length,
          'Exactly three signed upload URLs should be requested'
        ).toBe(3)

        expect(
          submitRequests.length,
          'Exactly one application submission should occur'
        ).toBe(1)

        expect(
          uploadedPaths.size,
          'Three unique storage paths should be returned'
        ).toBe(3)

        await expect(
          page.getByText(
            'Application submitted. You will receive a password setup email after approval.'
          )
        ).toBeVisible({
          timeout: 15_000,
        })

        console.log(
          '\n✓ Submission returned HTTP 201 and the success message appeared.'
        )

        for (
          let attempt = 1;
          attempt <= 10;
          attempt += 1
        ) {
          const {
            data,
            error,
          } = await supabaseAdmin
            .from('applications')
            .select(
              [
                'id',
                'property_id',
                'room_id',
                'name',
                'phone',
                'email',
                'blood_group',
                'message',
                'status',
                'id_proof',
                'photo',
                'payment_screenshot',
                'payment_transaction_id',
              ].join(',')
            )
            .eq(
              'email',
              testData.email
            )
            .eq(
              'phone',
              testData.phone
            )
            .eq(
              'payment_transaction_id',
              testData.transactionId
            )
            .maybeSingle()

          if (error) {
            throw new Error(
              `Could not verify application: ${error.message}`
            )
          }

          if (data) {
            application = data
            break
          }

          await page.waitForTimeout(1000)
        }

        expect(
          application,
          'The submitted application should exist in production'
        ).not.toBeNull()

        expect(application.name).toBe(
          testData.name
        )
        expect(application.phone).toBe(
          testData.phone
        )
        expect(application.email).toBe(
          testData.email
        )
        expect(
          application.blood_group
        ).toBe(testData.bloodGroup)
        expect(
          application.payment_transaction_id
        ).toBe(testData.transactionId)
        expect(application.status).toBe(
          'pending'
        )

        for (
          const path of [
            application.id_proof,
            application.photo,
            application.payment_screenshot,
          ]
        ) {
          if (
            typeof path === 'string' &&
            path
          ) {
            uploadedPaths.add(path)
          }
        }

        expect(
          uploadedPaths.size,
          'The application should reference three uploaded objects'
        ).toBe(3)

        console.log(
          `\n✓ Database application verified: ${application.id}`
        )

        for (
          let attempt = 1;
          attempt <= 10;
          attempt += 1
        ) {
          const {
            data,
            error,
          } = await supabaseAdmin
            .from('notifications')
            .select(
              'id,type,metadata'
            )
            .contains(
              'metadata',
              {
                application_id:
                  application.id,
              }
            )

          if (error) {
            throw new Error(
              `Could not verify owner notification: ${error.message}`
            )
          }

          if (
            Array.isArray(data) &&
            data.length > 0
          ) {
            notificationIds =
              data.map(item => item.id)
            break
          }

          await page.waitForTimeout(1000)
        }

        expect(
          notificationIds.length,
          'The application should create an owner notification'
        ).toBeGreaterThan(0)

        console.log(
          `\n✓ Owner notification verified: ${notificationIds.join(
            ', '
          )}`
        )

        await expect(page).toHaveURL(
          /\/login\/?$/,
          {
            timeout: 15_000,
          }
        )

        console.log(
          '\n✓ Success redirect to /login verified.'
        )
      } finally {
        console.log(
          '\n--- STEP 6 CLEANUP STARTED ---'
        )

        if (
          application &&
          application.id
        ) {
          const {
            error:
              notificationDeleteError,
          } = await supabaseAdmin
            .from('notifications')
            .delete()
            .contains(
              'metadata',
              {
                application_id:
                  application.id,
              }
            )

          if (
            notificationDeleteError
          ) {
            cleanupErrors.push(
              `Notification cleanup failed: ${notificationDeleteError.message}`
            )
          } else {
            console.log(
              '✓ Owner notification removed.'
            )
          }
        }

        if (
          uploadedPaths.size > 0
        ) {
          const paths =
            Array.from(uploadedPaths)

          const {
            error: storageDeleteError,
          } = await supabaseAdmin
            .storage
            .from('tenant-documents')
            .remove(paths)

          if (storageDeleteError) {
            cleanupErrors.push(
              `Storage cleanup failed: ${storageDeleteError.message}`
            )
          } else {
            console.log(
              `✓ ${paths.length} storage objects removed.`
            )
          }
        }

        if (
          application &&
          application.id
        ) {
          const {
            error:
              applicationDeleteError,
          } = await supabaseAdmin
            .from('applications')
            .delete()
            .eq(
              'id',
              application.id
            )

          if (
            applicationDeleteError
          ) {
            cleanupErrors.push(
              `Application cleanup failed: ${applicationDeleteError.message}`
            )
          } else {
            console.log(
              '✓ Application row removed.'
            )
          }
        } else {
          const {
            data: fallbackApplications,
            error:
              fallbackLookupError,
          } = await supabaseAdmin
            .from('applications')
            .select(
              'id,id_proof,photo,payment_screenshot'
            )
            .eq(
              'email',
              testData.email
            )
            .eq(
              'phone',
              testData.phone
            )
            .eq(
              'payment_transaction_id',
              testData.transactionId
            )

          if (fallbackLookupError) {
            cleanupErrors.push(
              `Fallback lookup failed: ${fallbackLookupError.message}`
            )
          }

          for (
            const item of
              fallbackApplications || []
          ) {
            const {
              error:
                fallbackNotificationError,
            } = await supabaseAdmin
              .from('notifications')
              .delete()
              .contains(
                'metadata',
                {
                  application_id:
                    item.id,
                }
              )

            if (
              fallbackNotificationError
            ) {
              cleanupErrors.push(
                `Fallback notification cleanup failed: ${fallbackNotificationError.message}`
              )
            }

            const fallbackPaths = [
              item.id_proof,
              item.photo,
              item.payment_screenshot,
            ].filter(Boolean)

            if (
              fallbackPaths.length > 0
            ) {
              const {
                error:
                  fallbackStorageError,
              } = await supabaseAdmin
                .storage
                .from(
                  'tenant-documents'
                )
                .remove(
                  fallbackPaths
                )

              if (
                fallbackStorageError
              ) {
                cleanupErrors.push(
                  `Fallback storage cleanup failed: ${fallbackStorageError.message}`
                )
              }
            }

            const {
              error:
                fallbackApplicationError,
            } = await supabaseAdmin
              .from('applications')
              .delete()
              .eq(
                'id',
                item.id
              )

            if (
              fallbackApplicationError
            ) {
              cleanupErrors.push(
                `Fallback application cleanup failed: ${fallbackApplicationError.message}`
              )
            }
          }
        }

        const {
          data: remainingApplications,
          error: remainingLookupError,
        } = await supabaseAdmin
          .from('applications')
          .select('id')
          .eq(
            'email',
            testData.email
          )
          .eq(
            'phone',
            testData.phone
          )
          .eq(
            'payment_transaction_id',
            testData.transactionId
          )

        if (remainingLookupError) {
          cleanupErrors.push(
            `Final cleanup verification failed: ${remainingLookupError.message}`
          )
        } else if (
          remainingApplications.length > 0
        ) {
          cleanupErrors.push(
            `${remainingApplications.length} test application row(s) remain`
          )
        } else {
          console.log(
            '✓ Final database cleanup verified.'
          )
        }

        console.log(
          '--- STEP 6 CLEANUP FINISHED ---'
        )

        expect(
          cleanupErrors,
          cleanupErrors.join('\n')
        ).toEqual([])
      }
    }
  )
})
