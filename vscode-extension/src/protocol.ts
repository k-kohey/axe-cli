// Protocol types for CLI ↔ Extension communication.
// Types are generated from cmd/internal/preview/proto/preview.proto via ts-proto.
// Wire format is JSON Lines (one JSON object per line).

// Re-export generated types as the public API.
export type {
  Command,
  Event,
  Frame,
  StreamStarted,
  StreamStopped,
  StreamStatus,
  AddStream,
  RemoveStream,
  SwitchFile,
  NextPreview,
  Input,
  TouchEvent,
  TextEvent,
} from "./generated/preview";

import type { Event, Command, Frame } from "./generated/preview";

// --- Type guards ---

export function isFrame(event: Event): event is Event & { frame: Frame } {
  return event.frame !== undefined;
}

export function isStreamStarted(
  event: Event
): event is Event & { streamStarted: import("./generated/preview").StreamStarted } {
  return event.streamStarted !== undefined;
}

export function isStreamStopped(
  event: Event
): event is Event & { streamStopped: import("./generated/preview").StreamStopped } {
  return event.streamStopped !== undefined;
}

export function isStreamStatus(
  event: Event
): event is Event & { streamStatus: import("./generated/preview").StreamStatus } {
  return event.streamStatus !== undefined;
}

// --- Parsing ---

/**
 * Parse a JSON line into an Event. Returns undefined if the line is not valid JSON
 * or does not contain a streamId.
 */
export function parseEvent(line: string): Event | undefined {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== "object" || obj === null || typeof obj.streamId !== "string") {
      return undefined;
    }
    return obj as Event;
  } catch {
    return undefined;
  }
}

/**
 * Serialize a Command to a JSON line (without trailing newline).
 */
export function serializeCommand(cmd: Command): string {
  return JSON.stringify(cmd);
}
