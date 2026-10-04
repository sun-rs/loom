// Reduced P99 actual rollout evidence; no answer bodies or credentials.
// rollout-2026-10-04T21-42-30-01a10726-e002-7500-ad4a-8ad309424e8f.jsonl
// sourceLine records original positions; replyAt comes from the original P99 result.
// Tool items have call/turn IDs but no response_id. Do not invent an ID mapping.
export const p99ReplyTiming = [
  {
    round: 1,
    replyAt: "2026-10-04T13:42:48.676Z",
    events: [
      {
        sourceLine: 11,
        timestamp: "2026-10-04T13:42:37.559Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ctc_0b8e5b098cc04871016ac257cc1e9087d09183d7731ca6b71d",
          call_id: "call_0NvnJUsL1RGiyxAXPl2Xgnq1",
          name: "exec",
          internal_chat_message_metadata_passthrough: {
            turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
            create_time: 1791121355.524201,
          },
        },
      },
      {
        sourceLine: 12,
        timestamp: "2026-10-04T13:42:37.610Z",
        type: "token_usage_record",
        payload: {
          response_id:
            "resp_0b8e5b098cc04871016ac257cb5cd087d09f6cb2e2f8dd1599",
          turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
          usage: {
            input_tokens: 11455,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 94,
            reasoning_output_tokens: 0,
            total_tokens: 11549,
          },
        },
      },
      {
        sourceLine: 16,
        timestamp: "2026-10-04T13:42:40.332Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ctc_0b8e5b098cc04871016ac257ced2fc87d094e5ac523aa46d9b",
          call_id: "call_wBp4NDb1eH7YtPhHIBQ6Iii6",
          name: "exec",
          internal_chat_message_metadata_passthrough: {
            turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
            create_time: 1791121358.255001,
          },
        },
      },
      {
        sourceLine: 18,
        timestamp: "2026-10-04T13:42:40.397Z",
        type: "token_usage_record",
        payload: {
          response_id:
            "resp_0b8e5b098cc04871016ac257ce2db487d0bdd956f6bb116bfc",
          turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
          usage: {
            input_tokens: 13010,
            cached_input_tokens: 11008,
            cache_write_input_tokens: 0,
            output_tokens: 95,
            reasoning_output_tokens: 0,
            total_tokens: 13105,
          },
        },
      },
      {
        sourceLine: 21,
        timestamp: "2026-10-04T13:42:48.664Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ctc_0b8e5b098cc04871016ac257d1eb2487d0804fcb0dfc6b196e",
          call_id: "call_RAfA7qJuOxvOY7fY1D8qc6Pj",
          name: "exec",
          internal_chat_message_metadata_passthrough: {
            turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
            create_time: 1791121361.31652,
          },
        },
      },
      {
        sourceLine: 23,
        timestamp: "2026-10-04T13:42:48.731Z",
        type: "token_usage_record",
        payload: {
          response_id:
            "resp_0b8e5b098cc04871016ac257d115e487d09f58b0c9bc6fcf29",
          turn_id: "01a10726-e129-7530-bfd7-af81f16be75f",
          usage: {
            input_tokens: 15848,
            cached_input_tokens: 12032,
            cache_write_input_tokens: 0,
            output_tokens: 389,
            reasoning_output_tokens: 0,
            total_tokens: 16237,
          },
        },
      },
    ],
  },
  {
    round: 2,
    replyAt: "2026-10-04T13:42:57.709Z",
    events: [
      {
        sourceLine: 33,
        timestamp: "2026-10-04T13:42:57.702Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ctc_0b8e5b098cc04871016ac257dc7b0487d0b3cdf0a13d64ba2f",
          call_id: "call_htlqxdQ0U0IqbD18hpj6GMPy",
          name: "exec",
          internal_chat_message_metadata_passthrough: {
            turn_id: "01a10727-2897-7c12-850f-b7ac5359ea0d",
            create_time: 1791121371.40782,
          },
        },
      },
      {
        sourceLine: 35,
        timestamp: "2026-10-04T13:42:57.754Z",
        type: "token_usage_record",
        payload: {
          response_id:
            "resp_0b8e5b098cc04871016ac257dafcf087d0b4ed70601fffdcfd",
          turn_id: "01a10727-2897-7c12-850f-b7ac5359ea0d",
          usage: {
            input_tokens: 17091,
            cached_input_tokens: 15104,
            cache_write_input_tokens: 0,
            output_tokens: 306,
            reasoning_output_tokens: 0,
            total_tokens: 17397,
          },
        },
      },
    ],
  },
  {
    round: 3,
    replyAt: "2026-10-04T13:43:03.842Z",
    events: [
      {
        sourceLine: 45,
        timestamp: "2026-10-04T13:43:03.837Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ctc_0b8e5b098cc04871016ac257e365b087d09069269d8d5179ef",
          call_id: "call_9xMlXXRd5E0tAZRRQ4q86U5P",
          name: "exec",
          internal_chat_message_metadata_passthrough: {
            turn_id: "01a10727-4b0d-75e3-8788-1595384b4f00",
            create_time: 1791121378.893652,
          },
        },
      },
      {
        sourceLine: 47,
        timestamp: "2026-10-04T13:43:04.521Z",
        type: "token_usage_record",
        payload: {
          response_id:
            "resp_0b8e5b098cc04871016ac257e2a8d487d0a79b71aa628e86fe",
          turn_id: "01a10727-4b0d-75e3-8788-1595384b4f00",
          usage: {
            input_tokens: 18159,
            cached_input_tokens: 16128,
            cache_write_input_tokens: 0,
            output_tokens: 261,
            reasoning_output_tokens: 0,
            total_tokens: 18420,
          },
        },
      },
    ],
  },
];
