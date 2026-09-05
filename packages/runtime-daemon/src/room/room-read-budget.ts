/** Exact uncompressed JSON wire budget for every Room read response. */
export const ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT = 1_048_576;

/** Bytes added when an already serialized application response is wrapped. */
export const ROOM_READ_HTTP_SUCCESS_ENVELOPE_BYTES = Buffer.byteLength(
  '{"ok":true,"data":}',
);

/** Maximum application payload that is guaranteed to fit the success envelope. */
export const ROOM_READ_RESPONSE_BYTE_LIMIT =
  ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT - ROOM_READ_HTTP_SUCCESS_ENVELOPE_BYTES;
