import type { SupabaseClient } from "npm:@supabase/supabase-js@2.39.8";
import { reminderRepairDueDates, reminderTimeIso } from "./rent-reminder-schedule.ts";

type DryRunOptions = {
  rentId?: string;
  tenantId?: string;
  limit?: number;
  referenceTime?: Date;
  getEnvironmentValue: (name: string) => string | undefined;
};

type RentRecord = {
  id: string;
  tenant_id: string;
  owner_id: string;
  due_date: string;
  amount: number;
  credited_amount?: number | null;
  status: string;
  reminders_enabled: boolean;
  reminder_timezone?: string | null;
};

type TenantRecord = {
  id: string;
  email: string | null;
  status: string | null;
};

type ReminderCandidate = {
  reminderType: keyof typeof TEMPLATE_ENV;
  scheduledAt: string;
  eligibleToday: boolean;
  dedupeKey: string;
};

type PaymentRow = {
  id: string;
  rent_id: string | null;
  amount: number;
  status: string;
  payment_method: string | null;
};

const TEMPLATE_ENV = {
  before_due: "BREVO_RENT_BEFORE_DUE_TEMPLATE_ID",
  due_today: "BREVO_RENT_DUE_TODAY_TEMPLATE_ID",
  overdue_2_days: "BREVO_RENT_OVERDUE_2_DAYS_TEMPLATE_ID",
  weekly_overdue: "BREVO_RENT_WEEKLY_OVERDUE_TEMPLATE_ID",
} as const;

const ACTIVE_TENANT_STATUSES = new Set(["active", "notice_period", "payment_pending"]);
const NON_RENT_PAYMENT_METHODS = new Set([
  "security_deposit",
  "deposit",
  "pre_booking",
  "pre-booking",
  "prebooking",
  "pre_booking_fee",
  "pre-booking_fee",
  "application_fee",
  "application-fee",
  "joining_fee",
  "joining-fee",
]);

function isMonthlyRentPaymentMethod(method: unknown): boolean {
  const normalized = String(method ?? "").trim().toLowerCase();
  return Boolean(normalized) && !NON_RENT_PAYMENT_METHODS.has(normalized);
}

function addDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString()
    .slice(0, 10);
}

function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000);
}

function templateConfigured(
  reminderType: keyof typeof TEMPLATE_ENV,
  getEnvironmentValue: DryRunOptions["getEnvironmentValue"],
): boolean {
  const value = Number(getEnvironmentValue(TEMPLATE_ENV[reminderType]));
  return Number.isInteger(value) && value > 0;
}

function emailDomain(email: string | null): string | null {
  const domain = String(email || "").split("@")[1];
  return domain || null;
}

function remindersFor(rent: RentRecord, referenceTime: Date) {
  const timeZone = rent.reminder_timezone || "Asia/Kolkata";
  const { today, beforeDueDate } = reminderRepairDueDates(referenceTime, timeZone);
  const overdueDays = daysBetween(rent.due_date, today);
  const candidates: ReminderCandidate[] = [
    {
      reminderType: "before_due" as const,
      scheduledAt: reminderTimeIso(addDays(rent.due_date, -3), timeZone),
      eligibleToday: rent.due_date === beforeDueDate,
      dedupeKey: `${rent.id}:before_due:0`,
    },
    {
      reminderType: "due_today" as const,
      scheduledAt: reminderTimeIso(rent.due_date, timeZone),
      eligibleToday: rent.due_date === today,
      dedupeKey: `${rent.id}:due_today:0`,
    },
    {
      reminderType: "overdue_2_days" as const,
      scheduledAt: reminderTimeIso(addDays(rent.due_date, 2), timeZone),
      eligibleToday: overdueDays >= 2,
      dedupeKey: `${rent.id}:overdue_2_days:0`,
    },
  ];
  if (overdueDays >= 2) {
    const sequence = Math.max(1, Math.floor((overdueDays - 2) / 7) + 1);
    candidates.push({
      reminderType: "weekly_overdue" as const,
      scheduledAt: reminderTimeIso(addDays(rent.due_date, 2 + sequence * 7), timeZone),
      eligibleToday: true,
      dedupeKey: `${rent.id}:weekly_overdue:${sequence}`,
    });
  }
  return { today, candidates };
}

export async function dryRunRentReminders(
  client: SupabaseClient,
  options: DryRunOptions,
) {
  const referenceTime = options.referenceTime ?? new Date();
  const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
  let query = client
    .from("rent_records")
    .select("id,tenant_id,owner_id,due_date,amount,credited_amount,status,reminders_enabled,reminder_timezone");
  if (options.rentId) query = query.eq("id", options.rentId);
  if (options.tenantId) query = query.eq("tenant_id", options.tenantId);

  const { data: rents, error: rentError } = await query
    .order("due_date", { ascending: true })
    .limit(limit);
  if (rentError) throw new Error(`Unable to inspect rent records: ${rentError.message}`);

  const rentRows = (rents ?? []) as RentRecord[];
  const tenantIds = [...new Set(rentRows.map((rent) => rent.tenant_id))];
  const { data: tenants, error: tenantError } = tenantIds.length
    ? await client.from("tenants").select("id,email,status").in("id", tenantIds)
    : { data: [], error: null };
  if (tenantError) {
    throw new Error(`Unable to inspect tenants: ${tenantError.message}`);
  }
  const tenantsById = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant as TenantRecord]));

  const rentIds = rentRows.map((rent) => rent.id);
  const { data: payments, error: paymentError } = rentIds.length
    ? await client
      .from("payment_history")
      .select("id,rent_id,amount,status,payment_method")
      .in("rent_id", rentIds)
    : { data: [], error: null };
  if (paymentError) {
    throw new Error(`Unable to inspect rent payments: ${paymentError.message}`);
  }
  const paymentRows = (payments ?? []) as PaymentRow[];
  const successfulRentPaymentsByRentId = new Map<string, PaymentRow[]>();
  const pendingRentIds = new Set<string>();
  for (const payment of paymentRows) {
    if (!payment.rent_id || !isMonthlyRentPaymentMethod(payment.payment_method)) {
      continue;
    }
    if (payment.status === "success") {
      const rows = successfulRentPaymentsByRentId.get(payment.rent_id) ?? [];
      rows.push(payment);
      successfulRentPaymentsByRentId.set(payment.rent_id, rows);
    }
    if (payment.status === "payment_pending") {
      pendingRentIds.add(payment.rent_id);
    }
  }

  const receivedAmountByRentId = new Map<string, number>();
  for (const rent of rentRows) {
    const { data: receivedAmount, error: receivedError } = await client
      .rpc("rent_record_received_amount", { p_rent_id: rent.id });
    if (receivedError) {
      throw new Error(
        `Unable to inspect canonical received amount: ${receivedError.message}`,
      );
    }
    receivedAmountByRentId.set(rent.id, Number(receivedAmount || 0));
  }

  const { data: queueRows, error: queueError } = rentIds.length
    ? await client
      .from("rent_reminder_queue")
      .select("rent_id,reminder_type,reminder_sequence,status,scheduled_at,retry_count")
      .in("rent_id", rentIds)
    : { data: [], error: null };
  if (queueError) {
    throw new Error(`Unable to inspect reminder queue: ${queueError.message}`);
  }
  const queueByKey = new Map((queueRows ?? []).map((row) => [
    `${row.rent_id}:${row.reminder_type}:${row.reminder_sequence}`,
    row,
  ]));

  return {
    dryRun: true,
    referenceTime: referenceTime.toISOString(),
    inspectedRentRecords: rentRows.length,
    reminders: rentRows.flatMap((rent) => {
      const tenant = tenantsById.get(rent.tenant_id);
      const { today, candidates } = remindersFor(rent, referenceTime);
      const canonicalReceivedAmount = receivedAmountByRentId.get(rent.id) ?? 0;
      const cycleAmount = Number(rent.amount || 0);
      const cycleFullyPaid = canonicalReceivedAmount >= cycleAmount;
      const linkedSuccessfulPayments =
        successfulRentPaymentsByRentId.get(rent.id) ?? [];
      const linkedSuccessfulPaymentIds = linkedSuccessfulPayments
        .map((payment) => payment.id);
      const baseSkip = cycleFullyPaid
        ? "rent_cycle_paid"
        : rent.status !== "unpaid"
        ? "rent_not_unpaid"
        : !rent.reminders_enabled
        ? "reminders_disabled"
        : pendingRentIds.has(rent.id)
        ? "payment_pending"
        : !tenant
        ? "tenant_missing"
        : !ACTIVE_TENANT_STATUSES.has(String(tenant.status || ""))
        ? "tenant_inactive"
        : !tenant.email
        ? "tenant_email_missing"
        : null;

      return candidates.map((candidate) => {
        const queue = queueByKey.get(candidate.dedupeKey);
        const skipReason = baseSkip ||
          (!candidate.eligibleToday ? "not_due_for_this_reminder_today" : null) ||
          (queue?.status === "succeeded" ? "already_succeeded" : null) ||
          (queue?.status === "dead_letter" ? "dead_letter" : null) ||
          (!templateConfigured(candidate.reminderType, options.getEnvironmentValue)
            ? "template_missing"
            : null);

        return {
          tenantId: rent.tenant_id,
          tenantStatus: tenant?.status || null,
          tenantEmailPresent: Boolean(tenant?.email),
          tenantEmailDomain: emailDomain(tenant?.email || null),
          ownerId: rent.owner_id,
          rentId: rent.id,
          reminderType: candidate.reminderType,
          dueDate: rent.due_date,
          localDate: today,
          amount: rent.amount,
          cycleAmount,
          canonicalReceivedAmount,
          cycleFullyPaid,
          linkedSuccessfulPaymentIds,
          pendingPaymentPresent: pendingRentIds.has(rent.id),
          scheduledAt: candidate.scheduledAt,
          queueStatus: queue?.status || "missing",
          queueScheduledAt: queue?.scheduled_at || null,
          templateEnv: TEMPLATE_ENV[candidate.reminderType],
          templateConfigured: templateConfigured(candidate.reminderType, options.getEnvironmentValue),
          dedupeKey: candidate.dedupeKey,
          eligible: !skipReason,
          skipReason,
        };
      });
    }),
  };
}
