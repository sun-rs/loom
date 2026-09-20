/** Room timeline notices eligible for sidebar unread counts.
 * Archiving hides the channel; its historical notice must not become new unread
 * when it reappears. Unarchive contributes normally, without erasing older messages.
 * Alias e is a room_events row. Runtime/Task diagnostics never become unread chat.
 * Same-Room thread receipts stay in their thread, not the Room's sidebar count.
 */
export const roomTimelineNoticeSql = `(e.type='room.unarchived'
  OR (e.type='membership.added' AND json_type(e.payload_json,'$.participantId')='text')
  OR (e.type='reminder.fired'
    AND json_type(e.payload_json,'$.messageId')='text'
    AND json_type(e.payload_json,'$.anchorRoomId')='text'
    AND json_type(e.payload_json,'$.title')='text'
    AND NOT (COALESCE(json_type(e.payload_json,'$.threadId'),'')='text'
      AND json_extract(e.payload_json,'$.anchorRoomId')=e.room_id)))`;
