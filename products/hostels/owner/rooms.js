export const OWNER_ROOM_DEFAULT_DEPOSIT_AMOUNT = 3000;

export const OWNER_ROOM_INITIAL_FORM = Object.freeze({
  room_number: '',
  sharing_type: 'double',
  monthly_rent: 10000,
  room_audience: 'coliving',
});

export const OWNER_ROOM_SHARING_TYPES = Object.freeze([
  { value: 'single', label: 'Single Sharing', capacity: 1, icon: '👤', price: 15000 },
  { value: 'double', label: 'Double Sharing', capacity: 2, icon: '👥', price: 10000 },
  { value: 'triple', label: 'Triple Sharing', capacity: 3, icon: '👥👤', price: 8000 },
  { value: 'four', label: 'Four Sharing', capacity: 4, icon: '👥👥', price: 7000 },
  { value: 'five', label: 'Five Sharing', capacity: 5, icon: '👥👥👤', price: 6000 },
]);

export function createOwnerRoomFormDefaults() {
  return { ...OWNER_ROOM_INITIAL_FORM };
}

export function getOwnerRoomSharingType(sharingType) {
  return OWNER_ROOM_SHARING_TYPES.find(type => type.value === sharingType);
}

export function isDuplicateOwnerRoomNumber(rooms = [], roomNumber) {
  return rooms.some(room => room.room_number === roomNumber);
}

export function summarizeOwnerRooms(rows = [], options = {}) {
  const coerceNumbers = options.coerceNumbers !== false;
  const totalRooms = rows.length;
  const occupied = rows.filter(room => (
    coerceNumbers
      ? Number(room.current_occupants || 0) >= Number(room.capacity || 0)
      : room.current_occupants >= room.capacity
  )).length;
  return { totalRooms, occupied, vacant: totalRooms - occupied };
}

export function buildOwnerRoomInsert(property, roomForm) {
  const selectedType = getOwnerRoomSharingType(roomForm.sharing_type);
  return {
    property_id: property.id,
    room_number: roomForm.room_number,
    sharing_type: roomForm.sharing_type,
    monthly_rent: parseInt(roomForm.monthly_rent) || selectedType.price,
    deposit_amount: OWNER_ROOM_DEFAULT_DEPOSIT_AMOUNT,
    room_audience: roomForm.room_audience,
    capacity: selectedType.capacity,
    current_occupants: 0,
    status: 'vacant',
  };
}

export async function addOwnerRoom(supabaseClient, property, roomForm) {
  const { data, error } = await supabaseClient
    .from('rooms')
    .insert(buildOwnerRoomInsert(property, roomForm))
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOwnerRoom(supabaseClient, roomId) {
  const { error } = await supabaseClient.from('rooms').delete().eq('id', roomId);
  if (error) throw error;
}

export function validateOwnerRoomSettings(roomSettings, currentOccupants) {
  const roomNumber = String(roomSettings.room_number || '').trim();
  const monthlyRent = Number(roomSettings.monthly_rent);
  const capacity = Number(roomSettings.capacity);

  if (!roomNumber) return { valid: false, message: 'Room number is required' };
  if (!Number.isFinite(monthlyRent) || monthlyRent < 0) return { valid: false, message: 'Monthly rent cannot be negative' };
  if (!Number.isInteger(capacity) || capacity <= 0) return { valid: false, message: 'Capacity must be a positive whole number' };
  if (capacity < currentOccupants) return { valid: false, message: 'Capacity cannot be lower than current occupants' };

  return {
    valid: true,
    values: {
      roomNumber,
      monthlyRent,
      capacity,
    },
  };
}

export function buildOwnerRoomUpdateArgs(room, roomSettings, currentOccupants) {
  const validation = validateOwnerRoomSettings(roomSettings, currentOccupants);
  if (!validation.valid) throw new Error(validation.message);

  return {
    p_room_id: room.id,
    p_room_number: validation.values.roomNumber,
    p_monthly_rent: validation.values.monthlyRent,
    p_capacity: validation.values.capacity,
    p_sharing_type: roomSettings.sharing_type,
    p_room_audience: roomSettings.room_audience,
  };
}

export async function updateOwnerRoom(supabaseClient, room, roomSettings, currentOccupants) {
  const { data, error } = await supabaseClient.rpc(
    'update_owner_room',
    buildOwnerRoomUpdateArgs(room, roomSettings, currentOccupants),
  );
  if (error) throw error;
  return data;
}
