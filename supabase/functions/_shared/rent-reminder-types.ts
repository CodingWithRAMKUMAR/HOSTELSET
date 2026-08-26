export type RentReminderType =
  | "before_due"
  | "due_today"
  | "overdue_2_days"
  | "weekly_overdue";

export type ClaimedRentReminder = {
  id: string;
  tenant_id: string;
  owner_id: string;
  rent_id: string;
  reminder_type: RentReminderType;
  scheduled_at: string;
  retry_count: number;
  tenant_email: string | null;
  tenant_name: string | null;
  amount: number;
  due_date: string;
};

export type ReminderSchedulerResult = {
  vacates_completed?: number;
  materialized_rents: number;
  rent_records_reconciled?: number;
  paid_cycle_reminders_cancelled?: number;
  weekly_reminders_scheduled: number;
  stale_locks_recovered: number;
  stale_reminders_cancelled: number;
  pending_payment_reminders_cancelled?: number;
  ready_for_delivery: number;
};

export interface RentReminderRepository {
  refreshSchedule(): Promise<ReminderSchedulerResult>;
  claimDue(
    lockToken: string,
    batchSize: number,
  ): Promise<ClaimedRentReminder[]>;
  cancelIfPaid(
    reminderId: string,
    rentId: string,
    lockToken: string,
  ): Promise<boolean>;
  complete(reminderId: string, lockToken: string): Promise<void>;
  fail(reminderId: string, lockToken: string, reason: string): Promise<void>;
}
