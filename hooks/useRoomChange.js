import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export function useRoomChange(tenant, refreshData, initialPendingRequest = null, initialLastDecision = null, snapshotLoaded = false) {
  const [pendingRoomChangeRequest, setPendingRoomChangeRequest] = useState(null);
  const [lastRoomChangeDecision, setLastRoomChangeDecision] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [showRoomChangeModal, setShowRoomChangeModal] = useState(false);
  const [selectedNewRoom, setSelectedNewRoom] = useState('');
  const [roomChangeReason, setRoomChangeReason] = useState('');
  const [roomChangeSubmitting, setRoomChangeSubmitting] = useState(false);

  useEffect(() => {
    if (!snapshotLoaded) return;
    setPendingRoomChangeRequest(initialPendingRequest || null);
    setLastRoomChangeDecision(initialLastDecision || null);
  }, [initialLastDecision, initialPendingRequest, snapshotLoaded]);

  const loadRoomChangeState = async () => {
    if (!tenant?.id) return;
    const [pendingResult, decisionResult] = await Promise.all([
      supabase
        .from('room_change_requests')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('status', 'pending')
        .maybeSingle(),
      supabase
        .from('room_change_requests')
        .select('id, status, rejection_reason, processed_at, new_room_id')
        .eq('tenant_id', tenant.id)
        .in('status', ['approved', 'rejected'])
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (pendingResult.error) throw pendingResult.error;
    if (decisionResult.error) throw decisionResult.error;
    setPendingRoomChangeRequest(pendingResult.data || null);
    setLastRoomChangeDecision(decisionResult.data || null);
  };

  const fetchAvailableRooms = async () => {
    if (!tenant?.property_id) return;
    try {
      const { data: allRooms, error } = await supabase
        .from('rooms')
        .select('id, room_number, sharing_type, monthly_rent, capacity, current_occupants')
        .eq('property_id', tenant.property_id)
        .neq('id', tenant.room_id);
      if (error) throw error;

      const available = allRooms.filter(room => room.current_occupants < room.capacity);
      setAvailableRooms(available);
      if (available.length === 0) toast('No rooms available for change.', { icon: 'ℹ️' });
    } catch (error) {
      console.error('Fetch available rooms error:', error);
      toast.error('Failed to load available rooms');
      setAvailableRooms([]);
    }
  };

  const openRoomChangeModal = () => {
    fetchAvailableRooms();
    setSelectedNewRoom('');
    setRoomChangeReason('');
    setShowRoomChangeModal(true);
  };

  const submitRoomChangeRequest = async () => {
    if (roomChangeSubmitting) return false;
    if (!selectedNewRoom) { toast.error('Please select a room'); return false; }
    if (pendingRoomChangeRequest) { toast.error('You already have a pending room change request'); return false; }
    setRoomChangeSubmitting(true);
    try {
      const { data, error } = await supabase.from('room_change_requests').insert({
        tenant_id: tenant.id,
        property_id: tenant.property_id,
        old_room_id: tenant.room_id,
        new_room_id: selectedNewRoom,
        reason: roomChangeReason || null,
        status: 'pending',
        requested_at: new Date().toISOString()
      }).select('*').single();
      if (error) throw error;
      setPendingRoomChangeRequest(data);
      setLastRoomChangeDecision(null);
      toast.success('Room change request submitted!');
      setShowRoomChangeModal(false);
      setSelectedNewRoom('');
      setRoomChangeReason('');
      return true;
    } catch (error) {
      console.error('Room change request error:', error);
      toast.error('Failed to submit request: ' + error.message);
      return false;
    } finally {
      setRoomChangeSubmitting(false);
    }
  };

  // Real-time room change updates
  useEffect(() => {
    if (!tenant?.id) return;
    if (!snapshotLoaded) {
      loadRoomChangeState().catch((error) => console.error('Room change state error:', error));
    }

    const channel = supabase.channel(`tenant:${tenant.id}:room-change`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_change_requests', filter: `tenant_id=eq.${tenant.id}` }, (payload) => {
        const changedRequest = payload.new || payload.old;
        if (changedRequest?.tenant_id === tenant.id) {
          if (payload.eventType === 'UPDATE') {
            if (payload.new.status === 'approved' || payload.new.status === 'rejected') {
              setPendingRoomChangeRequest(null);
              setLastRoomChangeDecision(payload.new);
              if (payload.new.status === 'approved') {
                toast.success('✅ Your room change request was approved!');
                void refreshData({
                  background: true,
                  force: true,
                  reason: 'room-change-approved',
                });
              } else {
                toast.error(`❌ Room change rejected${payload.new.rejection_reason ? `: ${payload.new.rejection_reason}` : '.'}`);
              }
            }
          }
        }
        if (payload.eventType === 'INSERT' && payload.new?.status === 'pending') {
          setPendingRoomChangeRequest(payload.new);
          setLastRoomChangeDecision(null);
        } else if (payload.eventType === 'DELETE') {
          setPendingRoomChangeRequest(current => current?.id === changedRequest?.id ? null : current);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id, snapshotLoaded, refreshData]);

  return {
    pendingRoomChangeRequest,
    lastRoomChangeDecision,
    availableRooms,
    showRoomChangeModal,
    setShowRoomChangeModal,
    selectedNewRoom,
    setSelectedNewRoom,
    roomChangeReason,
    setRoomChangeReason,
    openRoomChangeModal,
    submitRoomChangeRequest,
    roomChangeSubmitting
  };
}
