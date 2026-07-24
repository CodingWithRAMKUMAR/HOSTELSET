-- Prevent authenticated callers from impersonating another owner when
-- converting a reserved pre-booking into a tenant.

CREATE OR REPLACE FUNCTION public.convert_reserved_prebooking_to_tenant(
  p_booking_id uuid,
  p_user_id uuid,
  p_converted_by uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  booking public.pre_bookings%ROWTYPE;
  requested_booking public.pre_bookings%ROWTYPE;
  room_record public.rooms%ROWTYPE;
  property_owner uuid;
  new_tenant_id uuid;
  paid numeric;

  -- Always identify the actor from the verified Supabase session.
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Keep the existing parameter for application compatibility,
  -- but reject callers attempting to claim another identity.
  IF p_converted_by IS NOT NULL
     AND p_converted_by IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Applicant account is missing';
  END IF;

  SELECT *
  INTO requested_booking
  FROM public.pre_bookings
  WHERE id = p_booking_id;

  IF requested_booking.id IS NULL THEN
    RAISE EXCEPTION 'Pre-booking not found';
  END IF;

  IF requested_booking.status = 'converted' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'converted',
      'booking_id', requested_booking.id,
      'tenant_id', requested_booking.tenant_id,
      'email', requested_booking.email,
      'name', requested_booking.name,
      'already_converted', true
    );
  END IF;

  IF requested_booking.status <> 'reserved' THEN
    RAISE EXCEPTION 'Pre-booking is not reserved';
  END IF;

  IF requested_booking.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-booking has been removed';
  END IF;

  SELECT owner_id
  INTO property_owner
  FROM public.properties
  WHERE id = requested_booking.property_id;

  IF property_owner IS DISTINCT FROM actor_id
     AND NOT public.is_hostelset_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT *
  INTO room_record
  FROM public.rooms
  WHERE id = requested_booking.room_id
    AND property_id = requested_booking.property_id
  FOR UPDATE;

  IF room_record.id IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF COALESCE(room_record.current_occupants, 0) >= room_record.capacity THEN
    RAISE EXCEPTION 'The selected room is full';
  END IF;

  SELECT *
  INTO booking
  FROM public.pre_bookings reserved_booking
  WHERE reserved_booking.room_id = room_record.id
    AND reserved_booking.status = 'reserved'
    AND reserved_booking.deleted_at IS NULL
  ORDER BY
    reserved_booking.reserved_at ASC NULLS LAST,
    reserved_booking.created_at ASC,
    reserved_booking.id ASC
  LIMIT 1
  FOR UPDATE;

  IF booking.id IS NULL THEN
    RAISE EXCEPTION 'No active reserved pre-booking found';
  END IF;

  IF booking.id IS DISTINCT FROM requested_booking.id THEN
    RAISE EXCEPTION 'An earlier reserved pre-booking must be converted first';
  END IF;

  paid := GREATEST(0, COALESCE(booking.pre_booking_fee_amount, 0));

  IF paid <= 0 THEN
    RAISE EXCEPTION 'Pre-booking fee amount is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants tenant
    WHERE tenant.property_id = booking.property_id
      AND (
        tenant.user_id = p_user_id
        OR tenant.phone = booking.phone
        OR lower(tenant.email) = lower(booking.email)
      )
      AND tenant.status IN ('active', 'notice_period', 'payment_pending')
  ) THEN
    RAISE EXCEPTION 'Applicant already has a tenant record';
  END IF;

  INSERT INTO public.tenants (
    user_id,
    property_id,
    room_id,
    name,
    phone,
    email,
    rent_amount,
    pending_amount,
    total_paid,
    rent_status,
    move_in_date,
    status,
    profile_photo_path
  )
  VALUES (
    p_user_id,
    booking.property_id,
    booking.room_id,
    booking.name,
    booking.phone,
    booking.email,
    room_record.monthly_rent,
    GREATEST(0, room_record.monthly_rent - paid),
    paid,
    CASE
      WHEN room_record.monthly_rent <= paid THEN 'paid'
      ELSE 'pending'
    END,
    GREATEST(
      current_date,
      COALESCE(booking.expected_move_in_date, current_date)
    ),
    'active',
    CASE
      WHEN booking.photo LIKE booking.property_id::text || '/photos/%'
        AND booking.photo !~ '(^/|\.\.|//|[?#])'
      THEN booking.photo
      ELSE NULL
    END
  )
  RETURNING id INTO new_tenant_id;

  INSERT INTO public.payment_history (
    tenant_id,
    amount,
    payment_date,
    payment_method,
    status,
    upi_transaction_id,
    payment_screenshot,
    pre_booking_id
  )
  VALUES (
    new_tenant_id,
    paid,
    current_date,
    'pre_booking',
    'success',
    booking.payment_transaction_id,
    booking.payment_screenshot,
    booking.id
  );

  UPDATE public.rooms
  SET
    current_occupants = COALESCE(current_occupants, 0) + 1,
    status = CASE
      WHEN COALESCE(current_occupants, 0) + 1 >= capacity
      THEN 'occupied'
      ELSE 'vacant'
    END,
    updated_at = now()
  WHERE id = room_record.id;

  UPDATE public.pre_bookings
  SET
    status = 'converted',
    user_id = p_user_id,
    tenant_id = new_tenant_id,
    converted_at = now(),
    converted_by = actor_id,
    updated_at = now()
  WHERE id = booking.id;

  PERFORM public.refresh_room_public_availability(room_record.id);

  RETURN jsonb_build_object(
    'success', true,
    'status', 'converted',
    'booking_id', booking.id,
    'tenant_id', new_tenant_id,
    'room_id', room_record.id,
    'email', booking.email,
    'name', booking.name,
    'already_converted', false
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.convert_reserved_prebooking_to_tenant(uuid, uuid, uuid)
FROM public, anon;

GRANT EXECUTE
ON FUNCTION public.convert_reserved_prebooking_to_tenant(uuid, uuid, uuid)
TO authenticated;
