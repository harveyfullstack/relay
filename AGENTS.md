* Use the `bd` tool instead of markdown to coordinate all work and tasks.

# Using bv as an AI sidecar

bv is a fast terminal UI for Beads projects (.beads/beads.jsonl). It renders lists/details and precomputes dependency metrics (PageRank, critical path, cycles, etc.) so you instantly see blockers and execution order. For agents, it's a graph sidecar: instead of parsing JSONL or risking hallucinated traversal, call the robot flags to get deterministic, dependency-aware outputs.

*IMPORTANT: As an agent, you must ONLY use bv with the robot flags, otherwise you'll get stuck in the interactive TUI that's intended for human usage only!*

- bv --robot-help — shows all AI-facing commands.
- bv --robot-insights — JSON graph metrics (PageRank, betweenness, HITS, critical path, cycles) with top-N summaries for quick triage.
- bv --robot-plan — JSON execution plan: parallel tracks, items per track, and unblocks lists showing what each item frees up.
- bv --robot-priority — JSON priority recommendations with reasoning and confidence.
- bv --robot-recipes — list recipes (default, actionable, blocked, etc.); apply via bv --recipe <name> to pre-filter/sort before other flags.
- bv --robot-diff --diff-since <commit|date> — JSON diff of issue changes, new/closed items, and cycles introduced/resolved.

Use these commands instead of hand-rolling graph logic; bv already computes the hard parts so agents can act safely and quickly.

## Integrating with Beads (dependency-aware task planning)

Beads provides a lightweight, dependency-aware issue database and a CLI (`bd`) for selecting "ready work," setting priorities, and tracking status. Project: [steveyegge/beads](https://github.com/steveyegge/beads)

Recommended conventions
- **Single source of truth**: Use **Beads** for task status/priority/dependencies.
- **Shared identifiers**: Use the Beads issue id (e.g., `bd-123`) as identifiers and prefix message subjects with `[bd-123]`.

Typical flow (agents)
1) **Pick ready work** (Beads)
   - `bd ready --json` → choose one item (highest priority, no blockers)
2) **Announce start**
   - Update status: `bd update <id> --status=in_progress`
3) **Work and update**
   - Make progress on the task
4) **Complete**
   - `bd close <id> --reason "Completed"` (Beads is status authority)

Pitfalls to avoid
- Don't create or manage tasks in markdown; treat Beads as the single task queue.
- Always include `bd-###` in commit messages for traceability.
<!-- PRPM_MANIFEST_START -->

<skills_system priority="1">
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills (loaded into main context):
- Use the <path> from the skill entry below
- Invoke: Bash("cat <path>")
- The skill content will load into your current context
- Example: Bash("cat .openskills/backend-architect/SKILL.md")

Usage notes:
- Skills share your context window
- Do not invoke a skill that is already loaded in your context
</usage>

<available_skills>

<skill activation="lazy">
<name>frontend-design</name>
<description>Design and build modern frontend interfaces with best practices and user experience principles. Create beautiful, accessible, and performant web interfaces.</description>
<path>.openskills/frontend-design/SKILL.md</path>
</skill>

</available_skills>
</skills_system>

<!-- PRPM_MANIFEST_END -->

<!-- prpm:snippet:start @agent-relay/agent-relay-snippet@1.0.3 -->
# Agent Relay

Real-time agent-to-agent messaging. Output `->relay:` patterns to communicate.

## Sending Messages

**Always use the fenced format** for reliable message delivery:

```
->relay:AgentName <<<
Your message here.>>>
```

```
->relay:* <<<
Broadcast to all agents.>>>
```

**CRITICAL:** Always close multi-line messages with `>>>` on its own line!

## Communication Protocol

**ACK immediately** - When you receive a task, acknowledge it before starting work:

```
->relay:Sender <<<
ACK: Brief description of task received>>>
```

Then proceed with your work. This confirms message delivery and lets the sender know you're on it.

**Report completion** - When done, send a completion message:

```
->relay:Sender <<<
DONE: Brief summary of what was completed>>>
```

## Receiving Messages

Messages appear as:
```
Relay message from Alice [abc123]: Message content here
```

### Channel Routing (Important!)

Messages from #general (broadcast channel) include a `[#general]` indicator:
```
Relay message from Alice [abc123] [#general]: Hello everyone!
```

**When you see `[#general]`**: Reply to `*` (broadcast), NOT to the sender directly.

```
# Correct - responds to #general channel
->relay:* <<<
Response to the group message.>>>

# Wrong - sends as DM to sender instead of to the channel
->relay:Alice <<<
Response to the group message.>>>
```

This ensures your response appears in the same channel as the original message.

If truncated, read full message:
```bash
agent-relay read abc123
```

## Spawning Agents

Spawn workers to delegate tasks:

```
->relay:spawn WorkerName claude "task description"
->relay:release WorkerName
```

## Threads

Use threads to group related messages together. Thread syntax:

```
->relay:AgentName [thread:topic-name] <<<
Your message here.>>>
```

**When to use threads:**
- Working on a specific issue (e.g., `[thread:agent-relay-299]`)
- Back-and-forth discussions with another agent
- Code review conversations
- Any multi-message topic you want grouped

**Examples:**

```
->relay:Protocol [thread:auth-feature] <<<
How should we handle token refresh?>>>

->relay:Frontend [thread:auth-feature] <<<
Use a 401 interceptor that auto-refreshes.>>>

->relay:Reviewer [thread:pr-123] <<<
Please review src/auth/*.ts>>>

->relay:Developer [thread:pr-123] <<<
LGTM, approved!>>>
```

Thread messages appear grouped in the dashboard with reply counts.

## Common Patterns

```
->relay:Lead <<<
ACK: Starting /api/register implementation>>>

->relay:* <<<
STATUS: Working on auth module>>>

->relay:Lead <<<
DONE: Auth module complete>>>

->relay:Developer <<<
TASK: Implement /api/register>>>

->relay:Reviewer [thread:code-review-auth] <<<
REVIEW: Please check src/auth/*.ts>>>

->relay:Architect <<<
QUESTION: JWT or sessions?>>>
```

## Cross-Project Messaging

When running in bridge mode (multiple projects connected), use `project:agent` format:

```
->relay:frontend:Designer <<<
Please update the login UI for the new auth flow>>>

->relay:backend:lead <<<
API question - should we use REST or GraphQL?>>>

->relay:shared-lib:* <<<
New utility functions available, please pull latest>>>
```

**Format:** `->relay:project-id:agent-name`

**Special targets:**
- `->relay:project:lead` - Message the lead agent of that project
- `->relay:project:*` - Broadcast to all agents in that project
- `->relay:*:*` - Broadcast to ALL agents in ALL projects

**Cross-project threads:**
```
->relay:frontend:Designer [thread:auth-feature] <<<
UI mockups ready for review>>>
```

## Rules

- Pattern must be at line start (whitespace OK)
- Escape with `\->relay:` to output literally
- Check daemon status: `agent-relay status`

## Session Persistence (Required)

Output these blocks to maintain session state. **The system monitors your output for these patterns.**

### Progress Summary (Output Periodically)

When completing significant work, output a summary block:

```
[[SUMMARY]]
{
  "currentTask": "What you're working on now",
  "completedTasks": ["task1", "task2"],
  "context": "Important context for session recovery",
  "files": ["src/file1.ts", "src/file2.ts"]
}
[[/SUMMARY]]
```

**When to output:**
- After completing a major task
- Before long-running operations
- When switching to a different area of work
- Every 10-15 minutes of active work

### Session End (Required on Completion)

When your work session is complete, output:

```
[[SESSION_END]]
{
  "summary": "Brief description of what was accomplished",
  "completedTasks": ["task1", "task2", "task3"]
}
[[/SESSION_END]]
```

Or for a simple close: `[[SESSION_END]]Work complete.[[/SESSION_END]]`

**This enables:**
- Session recovery if connection drops
- Progress tracking in dashboard
- Proper session cleanup in cloud

## Session Continuity (Cross-Session)

Output `->continuity:` patterns to persist state across sessions. This is different from `[[SUMMARY]]` blocks - continuity creates permanent records that survive agent restarts.

### Save Session State

Save your current state to the ledger:

```
->continuity:save <<<
Current task: Implementing user authentication
Completed: User model, JWT utils, Login endpoint
In progress: Logout endpoint, Token refresh
Key decisions: Using refresh tokens for security
Files: src/auth/jwt.ts:10-50, src/models/user.ts
>>>
```

To also create a permanent handoff document (recommended before long operations):

```
->continuity:save --handoff <<<
Current task: Implementing auth module
Completed: User model, JWT utils
Next steps: Login endpoint, Session middleware
Key decisions: JWT with refresh tokens, bcrypt for passwords
Files: src/auth/*.ts
>>>
```

### Load Previous Context

Request your previous session context (auto-loaded on startup, but can request manually):

```
->continuity:load
```

### Search Past Work

Search across all previous handoffs:

```
->continuity:search "authentication patterns"
->continuity:search "database migration"
```

### Mark Uncertain Items

Flag items that need verification in future sessions:

```
->continuity:uncertain "API rate limit handling unclear"
```

### When to Save

**Always save before:**
- Long-running operations (builds, tests, deployments)
- Context-heavy operations (might trigger compaction)
- Switching to a different task area
- Taking a break or ending session

**Good rhythm:**
- Save progress every 15-20 minutes of active work
- Use `--handoff` flag for major milestones
- Mark uncertainties as you encounter them
<!-- prpm:snippet:end @agent-relay/agent-relay-snippet@1.0.3 -->

<!-- prpm:snippet:start @agent-workforce/trail-snippet@1.0.0 -->
# Trail

Record your work as a trajectory for future agents and humans to follow.

## When Starting Work

Start a trajectory when beginning a task:

```bash
trail start "Implement user authentication"
```

With external task reference:
```bash
trail start "Fix login bug" --task "ENG-123"
```

## Recording Decisions

Record key decisions as you work:

```bash
trail decision "Chose JWT over sessions" \
  --reasoning "Stateless scaling requirements"
```

For minor decisions, reasoning is optional:
```bash
trail decision "Used existing auth middleware"
```

**Record decisions when you:**
- Choose between alternatives
- Make architectural trade-offs
- Decide on an approach after investigation

## Completing Work

When done, complete with a retrospective:

```bash
trail complete --summary "Added JWT auth with refresh tokens" --confidence 0.85
```

**Confidence levels:**
- 0.9+ : High confidence, well-tested
- 0.7-0.9 : Good confidence, standard implementation
- 0.5-0.7 : Some uncertainty, edge cases possible
- <0.5 : Significant uncertainty, needs review

## Abandoning Work

If you need to stop without completing:

```bash
trail abandon --reason "Blocked by missing API credentials"
```

## Checking Status

View current trajectory:
```bash
trail status
```

## Why Trail?

Your trajectory helps others understand:
- **What** you built (commits show this)
- **Why** you built it this way (trajectory shows this)
- **What alternatives** you considered
- **What challenges** you faced

Future agents can query past trajectories to learn from your decisions.
<!-- prpm:snippet:end @agent-workforce/trail-snippet@1.0.0 -->
