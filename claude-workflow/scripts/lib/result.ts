export interface RunResult {
  text: string;
  sessionId: string | null;
  isError: boolean;
  found: boolean;
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
}

function parseLines(logContent: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of logContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // partial/corrupt line (e.g. process killed mid-write) — skip
    }
  }
  return events;
}

export function extractResult(logContent: string): RunResult {
  const events = parseLines(logContent);
  const resultEvent = [...events].reverse().find((e) => e.type === "result");
  const initEvent = events.find((e) => e.type === "system" && e.subtype === "init");

  if (!resultEvent) {
    return {
      text: "",
      sessionId: initEvent?.session_id ?? null,
      isError: true,
      found: false,
    };
  }
  return {
    text: resultEvent.result ?? "",
    sessionId: resultEvent.session_id ?? initEvent?.session_id ?? null,
    isError: resultEvent.is_error ?? false,
    found: true,
  };
}
