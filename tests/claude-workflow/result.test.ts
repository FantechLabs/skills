import { describe, expect, it } from "vite-plus/test";

import { extractResult } from "../../skills/claude-workflow/scripts/lib/result";

const initEvent = JSON.stringify({
  type: "system",
  subtype: "init",
  session_id: "sess-123",
});
const assistantEvent = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "working..." }] },
});
const successEvent = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "# Report\n\nAll good.",
  session_id: "sess-123",
});
const errorEvent = JSON.stringify({
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  result: "Execution failed: boom",
  session_id: "sess-456",
});

describe("extractResult", () => {
  it("extracts text and session id from a successful run", () => {
    const log = [initEvent, assistantEvent, successEvent].join("\n");
    expect(extractResult(log)).toEqual({
      text: "# Report\n\nAll good.",
      sessionId: "sess-123",
      isError: false,
      found: true,
    });
  });

  it("flags error results", () => {
    const log = [initEvent, errorEvent].join("\n");
    const r = extractResult(log);
    expect(r.isError).toBe(true);
    expect(r.found).toBe(true);
    expect(r.sessionId).toBe("sess-456");
  });

  it("falls back to the init session id when no result event exists (crash)", () => {
    const log = [initEvent, assistantEvent].join("\n");
    expect(extractResult(log)).toEqual({
      text: "",
      sessionId: "sess-123",
      isError: true,
      found: false,
    });
  });

  it("tolerates malformed lines", () => {
    const log = ["not json", initEvent, "{", successEvent].join("\n");
    expect(extractResult(log).text).toBe("# Report\n\nAll good.");
  });
});
