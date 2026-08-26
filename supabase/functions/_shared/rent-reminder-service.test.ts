import type { EmailService, EmailTemplateRequest } from "./email-service.ts";
import { RentReminderService } from "./rent-reminder-service.ts";
import type {
  ClaimedRentReminder,
  ReminderSchedulerResult,
  RentReminderRepository,
} from "./rent-reminder-types.ts";

const schedulerResult: ReminderSchedulerResult = {
  materialized_rents: 1,
  weekly_reminders_scheduled: 0,
  stale_locks_recovered: 0,
  stale_reminders_cancelled: 0,
  ready_for_delivery: 1,
};

const reminder: ClaimedRentReminder = {
  id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  owner_id: "00000000-0000-4000-8000-000000000003",
  rent_id: "00000000-0000-4000-8000-000000000004",
  reminder_type: "due_today",
  scheduled_at: "2026-06-30T03:30:00.000Z",
  retry_count: 0,
  tenant_email: "tenant@example.com",
  tenant_name: "Tenant",
  amount: 8000,
  due_date: "2026-06-30",
};

class FakeRepository implements RentReminderRepository {
  claimed = false;
  cancelPaid = false;
  completed = 0;
  failed = 0;

  async refreshSchedule(): Promise<ReminderSchedulerResult> {
    return schedulerResult;
  }

  async claimDue(): Promise<ClaimedRentReminder[]> {
    this.claimed = true;
    return [reminder];
  }

  async cancelIfPaid(): Promise<boolean> {
    return this.cancelPaid;
  }

  async complete(): Promise<void> {
    this.completed += 1;
  }

  async fail(): Promise<void> {
    this.failed += 1;
  }
}

class FakeEmailService implements EmailService {
  sent: EmailTemplateRequest[] = [];

  constructor(
    readonly configured: boolean,
    private readonly shouldFail = false,
  ) {}

  async sendTemplate(
    request: EmailTemplateRequest,
  ): Promise<Record<string, never>> {
    if (this.shouldFail) throw new Error("Provider unavailable");
    this.sent.push(request);
    return {};
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("does not claim reminders when delivery is disabled", async () => {
  const repository = new FakeRepository();
  const service = new RentReminderService(
    repository,
    new FakeEmailService(false),
  );

  const result = await service.run();

  assert(!repository.claimed, "disabled delivery must not claim queue rows");
  assert(!result.deliveryEnabled, "delivery should be reported as disabled");
});

Deno.test("completes a reminder after provider success", async () => {
  const repository = new FakeRepository();
  const email = new FakeEmailService(true);
  const service = new RentReminderService(repository, email);

  const result = await service.run();

  assert(result.succeeded === 1, "one reminder should succeed");
  assert(repository.completed === 1, "successful reminder should be completed");
  assert(
    email.sent[0].idempotencyKey === reminder.id,
    "queue id must be the idempotency key",
  );
});

Deno.test("does not send a claimed reminder when the cycle was just paid", async () => {
  const repository = new FakeRepository();
  repository.cancelPaid = true;
  const email = new FakeEmailService(true);
  const service = new RentReminderService(repository, email);

  const result = await service.run();

  assert(result.cancelledPaid === 1, "paid reminder should be cancelled");
  assert(email.sent.length === 0, "paid cycle must not reach the provider");
  assert(repository.completed === 0, "cancelled paid cycle is not completed");
  assert(repository.failed === 0, "cancelled paid cycle is not retried");
});

Deno.test("records a retry after provider failure", async () => {
  const repository = new FakeRepository();
  const service = new RentReminderService(
    repository,
    new FakeEmailService(true, true),
  );

  const result = await service.run();

  assert(result.failed === 1, "one reminder should fail");
  assert(
    repository.failed === 1,
    "failed reminder should be returned for retry",
  );
});
