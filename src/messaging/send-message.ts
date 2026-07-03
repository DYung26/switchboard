import type { MessageEnvelope } from "@/types";
import { withTimeout } from "@/utils/with-timeout";
import { MESSAGE_RESPONSE_TIMEOUT_MS } from "@/constants/app";

interface ErrorResponse {
  error: string;
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

export async function sendMessage<TPayload, TResponse>(
  type: string,
  payload: TPayload,
): Promise<TResponse> {
  const envelope: MessageEnvelope<string, TPayload> = { type, payload };
  const response = await withTimeout(
    chrome.runtime.sendMessage<MessageEnvelope<string, TPayload>, unknown>(
      envelope,
    ),
    MESSAGE_RESPONSE_TIMEOUT_MS,
  );

  if (isErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response as TResponse;
}
