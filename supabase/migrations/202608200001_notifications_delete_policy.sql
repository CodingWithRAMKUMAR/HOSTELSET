-- Allow authenticated users to delete their own notifications when the app
-- treats "mark as read" as removing the notification from the inbox.

alter table public.notifications enable row level security;

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
for delete to authenticated
using (recipient_user_id = auth.uid());

grant delete on table public.notifications to authenticated;
