# claude-workflow manual smoke test

One real explore run to verify the launcher end-to-end. Costs real tokens; run
against a small repo.

```bash
cd <your checkout of the fantechlabs skills repo>
cat > /tmp/cw-smoke.md <<'EOF'
Give a one-paragraph overview of this repository's structure and list its
skills. Use a small workflow (2-3 agents max).
EOF

RUN=$(bun skills/claude-workflow/scripts/workflow.ts start --mode explore \
  --prompt /tmp/cw-smoke.md --cwd . --name smoke | head -1)
echo "$RUN"

# watch progress (optional)
tail -f "$RUN/log.jsonl" &

while [ "$(bun skills/claude-workflow/scripts/workflow.ts status "$RUN")" = "running" ]; do sleep 15; done
bun skills/claude-workflow/scripts/workflow.ts result "$RUN"
```

Checks:
- [ ] `status` reports `running` while active, `completed` after.
- [ ] `result.md` contains the overview (not empty, not an error).
- [ ] `log.jsonl` contains a `Workflow` tool_use event (orchestration actually ran).
- [ ] No file modifications in the repo (`git status` clean) — explore stayed read-only.
- [ ] `session-id` exists; `resume "$RUN" --prompt <follow-up.md>` works.
