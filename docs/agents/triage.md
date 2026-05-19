# Linear Triage Labels

Agent Factory's Linear-first templates assume the agent can identify actionable work from a small, stable label vocabulary. Use these labels in Linear unless your team already has equivalent names.

| Role            | Recommended Linear label | Meaning                                  |
| --------------- | ------------------------ | ---------------------------------------- |
| Needs triage    | `needs-triage`           | Maintainer needs to evaluate this issue  |
| Needs info      | `needs-info`             | Waiting on reporter for more information |
| Ready for Codex | `ready-for-codex`        | Fully specified, ready for Codex         |
| Ready for human | `ready-for-human`        | Requires human implementation            |
| Won't fix       | `wontfix`                | Will not be actioned                     |

The Linear MCP tool must be installed and available to the agent before it can read, label, comment on, or close Linear tickets.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

---

When triaging or implementing requests for new agent CLI support (e.g. gemini-cli, cursor), see `docs/agents/adding-an-agent-provider.md` — it lists the CLI/output capabilities a new agent must satisfy and the files to touch.
