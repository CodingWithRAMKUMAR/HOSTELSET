const DAY_MS = 86400000

const NON_MONTHLY_RENT_METHODS = new Set([
  'security_deposit',
  'deposit',
  'pre_booking',
  'joining_fee',
  'application_fee',
])

const PENDING_RENT_STATUSES = new Set([
  'payment_pending',
  'pending',
  'pending_confirmation',
  'pending_owner_verification',
])

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? { year, month, day }
    : null
}

function anchoredDate(start, offset) {
  const index = start.year * 12 + start.month - 1 + offset
  const year = Math.floor(index / 12)
  const monthIndex = index % 12
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  return new Date(year, monthIndex, Math.min(start.day, lastDay))
}

function normalizeStatus(status) {
  return String(status || '').toLowerCase()
}

function normalizeMethod(method) {
  return String(method || '').toLowerCase()
}

function paymentStatus(payment) {
  return payment?.status ?? payment?.payment_status
}

function paymentMethodValues(payment = {}) {
  return [payment.payment_method, payment.method, payment.payment_type, payment.type, payment.paymentType].filter(Boolean)
}

function isMonthlyRentPayment(payment) {
  return !paymentMethodValues(payment).some(method => NON_MONTHLY_RENT_METHODS.has(normalizeMethod(method)))
}

function isConfirmedRent(payment) {
  return normalizeStatus(paymentStatus(payment)) === 'success' && isMonthlyRentPayment(payment)
}

function isPendingRentPayment(payment) {
  return PENDING_RENT_STATUSES.has(normalizeStatus(paymentStatus(payment))) && isMonthlyRentPayment(payment)
}

function uniquePayments(payments = [], predicate = () => true) {
  const seen = new Set()
  return (payments || [])
    .filter(predicate)
    .filter(payment => {
      const key = payment?.id || `${payment?.payment_date || payment?.created_at || ''}:${payment?.payment_method || ''}:${payment?.amount || 0}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => new Date(a.payment_date || a.created_at || 0) - new Date(b.payment_date || b.created_at || 0))
}

function uniqueConfirmedRentPayments(payments = []) {
  return uniquePayments(payments, isConfirmedRent)
}

function uniquePendingRentPayments(payments = []) {
  return uniquePayments(payments, isPendingRentPayment)
}

function toLocalDate(dateOnly) {
  return dateOnly ? new Date(dateOnly.year, dateOnly.month - 1, dateOnly.day) : null
}

function dateToIsoDate(date) {
  if (!date) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function businessTodayIsoDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {})
    return `${parts.year}-${parts.month}-${parts.day}`
  } catch {
    return dateToIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  }
}

function cycleOffsetFromStart(start, target) {
  return ((target.year - start.year) * 12) + (target.month - start.month)
}

function currentRentDueDateFromMoveIn(moveInDate, referenceDate = new Date()) {
  const start = parseDateOnly(moveInDate)
  if (!start) return ''
  const reference = parseDateOnly(typeof referenceDate === 'string' ? referenceDate : businessTodayIsoDate(referenceDate))
  if (!reference) return ''
  let offset = cycleOffsetFromStart(start, reference)
  if (offset < 0) offset = 0
  let dueDate = anchoredDate(start, offset)
  if (dueDate > toLocalDate(reference) && offset > 0) dueDate = anchoredDate(start, offset - 1)
  return dateToIsoDate(dueDate)
}

function adjacentRentDueDateFromMoveIn(moveInDate, dueDate, offsetDelta) {
  const start = parseDateOnly(moveInDate)
  const due = parseDateOnly(dueDate)
  if (!start || !due) return ''
  const offset = cycleOffsetFromStart(start, due) + offsetDelta
  return dateToIsoDate(anchoredDate(start, offset))
}

function previousRentDueDateFromMoveIn(moveInDate, dueDate) {
  return adjacentRentDueDateFromMoveIn(moveInDate, dueDate, -1)
}

function nextRentDueDateFromMoveIn(moveInDate, dueDate) {
  return adjacentRentDueDateFromMoveIn(moveInDate, dueDate, 1)
}

function dateOnlyBefore(left, right) {
  const leftDate = toLocalDate(left)
  const rightDate = toLocalDate(right)
  return Boolean(leftDate && rightDate && leftDate < rightDate)
}

function dateOnlyAfter(left, right) {
  const leftDate = toLocalDate(left)
  const rightDate = toLocalDate(right)
  return Boolean(leftDate && rightDate && leftDate > rightDate)
}

function countPeriodsThroughDate(start, paidThrough) {
  if (!paidThrough) return 0
  const throughDate = toLocalDate(paidThrough)
  let periods = 0
  while (periods < 600 && anchoredDate(start, periods) <= throughDate) periods += 1
  return periods
}

function explicitPaidThroughFromTenant(tenant = {}) {
  return parseDateOnly(
    tenant.paid_through_date ||
    tenant.last_paid_due_date ||
    tenant.last_rent_due_date_paid ||
    tenant.last_paid_date
  )
}

function baselinePaidPeriodsFromTenant(tenant, start, rent, confirmedPayments) {
  const explicitPaidThrough = explicitPaidThroughFromTenant(tenant)
  if (explicitPaidThrough) return countPeriodsThroughDate(start, explicitPaidThrough)

  if (normalizeStatus(tenant?.rent_status) !== 'paid') return 0
  if (Number(tenant?.pending_amount || 0) > 0) return 0

  const recognizedAt = parseDateOnly(tenant?.rent_recognized_at || tenant?.processed_at || tenant?.created_at)
  const firstPaymentAt = confirmedPayments
    .map(payment => parseDateOnly(payment?.payment_date || payment?.created_at))
    .filter(Boolean)
    .sort((a, b) => toLocalDate(a) - toLocalDate(b))[0]
  const proofDate = firstPaymentAt || recognizedAt
  const firstCycle = parseDateOnly(dateToIsoDate(anchoredDate(start, 0)))
  return dateOnlyBefore(firstCycle, proofDate) ? 1 : 0
}

function baselinePaidThroughDate(start, periods) {
  return periods > 0 ? anchoredDate(start, periods - 1) : null
}

function isAfterBaseline(payment, paidThroughDate) {
  if (!paidThroughDate) return true
  const paidAt = parseDateOnly(payment?.payment_date || payment?.created_at)
  if (!paidAt) return true
  const paidThrough = parseDateOnly(dateToIsoDate(paidThroughDate))
  return dateOnlyAfter(paidAt, paidThrough)
}

function consumePaymentAllocations(start, rent, baselinePeriods, confirmedPayments, cycleCount) {
  const queue = confirmedPayments.map(payment => ({
    id: payment.id || null,
    remaining: Number(payment.amount || 0),
  }))
  let cursor = 0
  const cycles = []
  for (let index = 0; index < cycleCount; index += 1) {
    const baselineAmount = index < baselinePeriods ? rent : 0
    let needed = Math.max(0, rent - baselineAmount)
    let paymentAmount = 0
    const paymentIds = []
    while (needed > 0.0001 && cursor < queue.length) {
      const item = queue[cursor]
      const applied = Math.min(needed, item.remaining)
      if (applied > 0) {
        paymentAmount += applied
        needed -= applied
        item.remaining -= applied
        if (item.id && !paymentIds.includes(item.id)) paymentIds.push(item.id)
      }
      if (item.remaining <= 0.0001) cursor += 1
    }
    const remainingAmount = Math.max(0, rent - baselineAmount - paymentAmount)
    cycles.push({
      index,
      dueDate: anchoredDate(start, index),
      baselineAmount,
      paymentAmount,
      remainingAmount,
      status: remainingAmount <= 0.0001 ? 'paid' : 'unpaid',
      paymentIds,
    })
  }
  return cycles
}

function inactiveResult() {
  return {
    status: 'inactive',
    dueDate: null,
    daysUntilDue: null,
    dueAmount: 0,
    message: 'Tenancy inactive',
    oldestUnpaidCycle: null,
    isFullyUpToDate: false,
    paidForCurrentCycle: false,
    currentCycleDueDate: null,
    currentCyclePaidAmount: 0,
    currentCycleDueAmount: 0,
    nextDueDate: null,
    paidThroughDate: null,
    totalPaid: 0,
    pendingConfirmationCount: 0,
  }
}

function unknownResult(tenant) {
  return {
    status: 'unknown',
    dueDate: null,
    daysUntilDue: null,
    dueAmount: Number(tenant?.pending_amount || 0),
    message: 'Due date unavailable',
    oldestUnpaidCycle: null,
    isFullyUpToDate: false,
    paidForCurrentCycle: false,
    currentCycleDueDate: null,
    currentCyclePaidAmount: 0,
    currentCycleDueAmount: Number(tenant?.pending_amount || 0),
    nextDueDate: null,
    paidThroughDate: null,
    totalPaid: 0,
    pendingConfirmationCount: 0,
  }
}

function calculateCanonicalRentDue(tenant, payments = [], now = new Date()) {
  if (['inactive', 'archived'].includes(normalizeStatus(tenant?.status))) return inactiveResult()

  const start = parseDateOnly(tenant?.rent_start_date || tenant?.move_in_date || tenant?.join_date)
  const rent = Number(tenant?.rent_amount || tenant?.monthly_rent)
  if (!start || !(rent > 0)) return unknownResult(tenant)

  const confirmedPayments = uniqueConfirmedRentPayments(payments)
  const pendingPayments = uniquePendingRentPayments(payments)
  const baselinePeriods = baselinePaidPeriodsFromTenant(tenant, start, rent, confirmedPayments)
  const baselineThrough = baselinePaidThroughDate(start, baselinePeriods)
  const allocatableConfirmedPayments = confirmedPayments.filter(payment => isAfterBaseline(payment, baselineThrough))
  const confirmedAmount = allocatableConfirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const totalPaid = confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const pendingAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Allocate all confirmed rent payments while retaining one additional
  // unpaid cycle for the canonical outstanding balance.
  const allocationCycleCount = Math.max(
    baselinePeriods + Math.ceil(confirmedAmount / rent) + 1,
    1
  )

  const cycleAllocations = consumePaymentAllocations(
    start,
    rent,
    baselinePeriods,
    allocatableConfirmedPayments,
    allocationCycleCount
  )

  // Advance only through consecutive fully paid cycles whose due dates
  // have arrived. A future-dated payment remains allocated to its future
  // cycle but does not advance the tenant's current paid period early.
  let paidPeriods = baselinePeriods

  for (const allocation of cycleAllocations) {
    if (allocation.index < baselinePeriods) continue
    if (allocation.index !== paidPeriods) break
    if (allocation.status !== 'paid') break

    const allocationDueDate = new Date(allocation.dueDate)
    if (allocationDueDate > today) break

    paidPeriods += 1
  }

  const dueDate = anchoredDate(start, paidPeriods)
  const daysUntilDue = Math.round((dueDate - today) / DAY_MS)

  const openCycleAllocation = cycleAllocations.find(
    allocation => allocation.index === paidPeriods
  )

  const paidAmountForOpenCycle = Math.max(
    0,
    Number(openCycleAllocation?.paymentAmount || 0)
  )

  const openCycleDueAmount = Math.max(
    0,
    Number(
      openCycleAllocation?.remainingAmount ??
      (rent - paidAmountForOpenCycle)
    )
  )

  const openCycleFullyPaid = openCycleDueAmount <= 0.0001

  const isCoveredByConfirmedPayment =
    paidPeriods > 0 && paidAmountForOpenCycle === 0
  const paidThroughDate = baselinePaidThroughDate(start, paidPeriods)
  const rolledToNextUnpaidCycle =
    paidPeriods > baselinePeriods && dueDate <= today
  const oldestUnpaidCycle = {
    index: paidPeriods,
    dueDate,
    dueAmount: openCycleDueAmount,
    paidAmount: paidAmountForOpenCycle,
    requiredAmount: rent,
  }
  const base = {
    dueDate,
    daysUntilDue,
    dueAmount: openCycleDueAmount,
    paidPeriods,
    confirmedAmount,
    totalPaid,
    pendingAmount,
    pendingConfirmationCount: pendingPayments.length,
    paidAmountForOpenCycle,
    cycleIndex: paidPeriods,
    baselinePaidPeriods: baselinePeriods,
    paidThroughDate,
    currentCycleDueDate: dueDate,
    currentCyclePaidAmount: paidAmountForOpenCycle,
    currentCycleDueAmount: openCycleDueAmount,
    nextDueDate: dueDate,
    cycleAllocations,
    paidForCurrentCycle: false,
    currentCyclePaid: false,
    oldestUnpaidCycle,
    isFullyUpToDate: false,
  }

  if (pendingPayments.length > 0 && (!isCoveredByConfirmedPayment || daysUntilDue <= 3)) {
    return {
      ...base,
      status: 'pending_confirmation',
      message: 'Pending confirmation',
      urgent: daysUntilDue <= 3,
    }
  }

  if (openCycleFullyPaid && daysUntilDue > 0) {
    const followingDueDate = anchoredDate(start, paidPeriods + 1)

    return {
      ...base,
      status: 'paid',
      dueAmount: 0,
      currentCycleDueDate: dueDate,
      currentCyclePaidAmount: rent,
      currentCycleDueAmount: 0,
      nextDueDate: followingDueDate,
      paidThroughDate: dueDate,
      message: 'Paid in advance',
      urgent: false,
      paidForCurrentCycle: true,
      currentCyclePaid: true,
      isFullyUpToDate: true,
      oldestUnpaidCycle: {
        index: paidPeriods + 1,
        dueDate: followingDueDate,
        dueAmount: rent,
        paidAmount: 0,
        requiredAmount: rent,
      },
    }
  }

  if (
    isCoveredByConfirmedPayment &&
    daysUntilDue > 3
  ) {
    return {
      ...base,
      status: 'paid',
      dueAmount: 0,
      currentCycleDueDate: paidThroughDate,
      currentCyclePaidAmount: rent,
      currentCycleDueAmount: 0,
      nextDueDate: dueDate,
      message: 'Paid',
      urgent: false,
      paidForCurrentCycle: true,
      currentCyclePaid: true,
      isFullyUpToDate: true,
    }
  }

  if (daysUntilDue < 0) {
    return {
      ...base,
      status: 'overdue',
      message: `Overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'}`,
      urgent: true,
    }
  }
  if (daysUntilDue === 0) {
    return { ...base, status: 'due_today', message: 'Due today', urgent: true }
  }
  if (daysUntilDue <= 3) {
    return {
      ...base,
      status: 'due_soon',
      message: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
      urgent: true,
    }
  }
  return {
    ...base,
    status: 'upcoming',
    message: `Due in ${daysUntilDue} days`,
    urgent: false,
  }
}

function formatRentDueLabel(result = {}) {
  if (result.status === 'paid') return 'Paid'
  if (result.status === 'pending_confirmation') return 'Pending confirmation'
  if (result.status === 'inactive') return result.message || 'Tenancy inactive'
  if (result.status === 'unknown') return result.message || 'Due date unavailable'
  const days = Number(result.daysUntilDue)
  if (!Number.isFinite(days)) return result.message || 'Due date unavailable'
  if (days < 0) {
    const overdue = Math.abs(days)
    return `Overdue by ${overdue} day${overdue === 1 ? '' : 's'}`
  }
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

function formatRentDueDetail(result = {}, formatDate = value => value) {
  const currentDate = result.currentCycleDueDate || result.dueDate
  if (result.status === 'paid') {
    return result.nextDueDate ? `Next rent due: ${formatDate(result.nextDueDate)}` : 'Rent paid'
  }
  if (result.status === 'pending_confirmation') return 'Payment awaiting owner approval'
  if (result.status === 'due_today') return currentDate ? `Due today: ${formatDate(currentDate)}` : 'Due today'
  if (result.status === 'overdue') return currentDate ? `${formatRentDueLabel(result)} - Due ${formatDate(currentDate)}` : formatRentDueLabel(result)
  if (result.status === 'due_soon' || result.status === 'upcoming') return currentDate ? `${formatRentDueLabel(result)} - ${formatDate(currentDate)}` : formatRentDueLabel(result)
  return formatRentDueLabel(result)
}

module.exports = {
  NON_MONTHLY_RENT_METHODS,
  PENDING_RENT_STATUSES,
  parseDateOnly,
  anchoredDate,
  businessTodayIsoDate,
  currentRentDueDateFromMoveIn,
  previousRentDueDateFromMoveIn,
  nextRentDueDateFromMoveIn,
  isConfirmedRent,
  isPendingRentPayment,
  uniqueConfirmedRentPayments,
  uniquePendingRentPayments,
  calculateCanonicalRentDue,
  formatRentDueLabel,
  formatRentDueDetail,
}
