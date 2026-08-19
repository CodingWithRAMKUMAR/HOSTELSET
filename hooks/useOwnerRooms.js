import { useState } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import {
  OWNER_ROOM_SHARING_TYPES,
  addOwnerRoom,
  createOwnerRoomFormDefaults,
  deleteOwnerRoom,
  isDuplicateOwnerRoomNumber,
} from '../products/hostels/owner/rooms';

export function useOwnerRooms(property, rooms, setRooms, setStats) {
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomForm, setRoomForm] = useState(createOwnerRoomFormDefaults);
  const sharingTypes = OWNER_ROOM_SHARING_TYPES;

  // --- Add a new room ---
  const addRoom = async (isSubmitting, setIsSubmitting) => {
    if (isSubmitting) return;
    if (!roomForm.room_number) { toast.error('Enter room number'); return; }
    if (isDuplicateOwnerRoomNumber(rooms, roomForm.room_number)) { toast.error(`Room ${roomForm.room_number} already exists!`); return; }

    setIsSubmitting(true);
    try {
      const insertedRoom = await addOwnerRoom(supabase, property, roomForm);
      toast.success(`Room ${roomForm.room_number} added!`);
      setShowRoomModal(false);
      setRoomForm(createOwnerRoomFormDefaults());
      setRooms(prev => [...prev, insertedRoom]);
      setStats(prev => ({ ...prev, totalRooms: prev.totalRooms + 1, vacant: prev.vacant + 1 }));
    } catch (error) {
      toast.error('Failed to add room: ' + error.message);
    }
    setIsSubmitting(false);
  };

  // --- Delete a room ---
  const deleteRoom = async (id, isSubmitting, setIsSubmitting) => {
    if (isSubmitting) return;
    const room = rooms.find(r => r.id === id);
    if (room.current_occupants > 0) { toast.error(`Cannot delete room with ${room.current_occupants} occupants`); return; }
    if (!confirm(`Delete Room ${room.room_number}?`)) return;

    setIsSubmitting(true);
    try {
      await deleteOwnerRoom(supabase, id);
      toast.success('Room deleted');
      setRooms(prev => prev.filter(r => r.id !== id));
      setStats(prev => ({ ...prev, totalRooms: prev.totalRooms - 1, vacant: prev.vacant - 1 }));
    } catch {
      toast.error('Failed to delete room');
    }
    setIsSubmitting(false);
  };

  return {
    rooms,
    showRoomModal,
    setShowRoomModal,
    roomForm,
    setRoomForm,
    sharingTypes,
    addRoom,
    deleteRoom
  };
}
