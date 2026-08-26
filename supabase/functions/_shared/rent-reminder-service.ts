import type { EmailService } from "./email-service.ts";
import type {
  ClaimedRentReminder,
  ReminderSchedulerResult,
  RentReminderRepository,
} from "./rent-reminder-types.ts";

export type RentReminderRunResult = {
  scheduler: ReminderSchedulerResult;
  deliveryEnabled: boolean;
  claimed: number;
  cancelledPaid: number;
  succeeded: number;
  failed: number;
};

const MAX_ERROR_LENGTH = 2000;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function templateVariables(reminder: ClaimedRentReminder) {
  return {
    tenantName: reminder.tenant_name,
    tenantId: reminder.tenant_id,
    ownerId: reminder.owner_id,
    rentId: reminder.rent_id,
    reminderType: reminder.reminder_type,
    amount: reminder.amount,
    dueDate: reminder.due_date,
  };
}

export class RentReminderService {
  constructor(
    private readonly repository: RentReminderRepository,
    private readonly emailService: EmailService,
  ) {}

  async run(batchSize = 25): Promise<RentReminderRunResult> {
    const scheduler = await this.repository.refreshSchedule();

    // Do not claim rows until a provider exists. This keeps reminders pending
    // and prevents a no-op implementation from recording false successes.
    if (!this.emailService.configured) {
      return {
        scheduler,
        deliveryEnabled: false,
        claimed: 0,
        cancelledPaid: 0,
        succeeded: 0,
        failed: 0,
      };
    }

    const lockToken = crypto.randomUUID();
    const reminders = await this.repository.claimDue(lockToken, batchSize);
    let cancelledPaid = 0;
    let succeeded = 0;
    let failed = 0;

    for (const reminder of reminders) {
      try {
        const cancelled = await this.repository.cancelIfPaid(
          reminder.id,
          reminder.rent_id,
          lockToken,
        );
        if (cancelled) {
          cancelledPaid += 1;
          continue;
        }

        if (!reminder.tenant_email) {
          throw new Error("Tenant has no email address");
        }

        await this.emailService.sendTemplate({
          recipient: {
            email: reminder.tenant_email,
            name: reminder.tenant_name,
          },
          templateKey: reminder.reminder_type,
          variables: templateVariables(reminder),
          idempotencyKey: reminder.id,
        });
        await this.repository.complete(reminder.id, lockToken);
        succeeded += 1;
      } catch (error) {
        try {
          await this.repository.fail(
            reminder.id,
            lockToken,
            errorMessage(error),
          );
        } finally {
          failed += 1;
        }
      }
    }

    return {
      scheduler,
      deliveryEnabled: true,
      claimed: reminders.length,
      cancelledPaid,
      succeeded,
      failed,
    };
  }
}
