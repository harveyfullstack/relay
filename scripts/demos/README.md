# Multi-Agent Negotiation Demos

Three demos showcasing agents with competing priorities negotiating limited resources using the full agent-relay system with consensus voting.

## What These Demos Show

1. **Real-time agent communication** via relay daemon
2. **Structured negotiation** with clear phases
3. **Consensus voting** using `_consensus` system (quorum, majority, etc.)
4. **Dashboard visualization** of message flow and voting

## Prerequisites

```bash
# Build agent-relay and link globally
cd /path/to/relay
npm run build
npm link

# Verify
agent-relay --version

# Ensure claude CLI is authenticated
claude --version
```

## The Three Demos

### 1. Budget Allocation

**Scenario**: 3 teams (Frontend, Backend, Infra) compete for a $100K quarterly budget.

```bash
./scripts/demos/budget-negotiation.sh
```

**Features**:
- Teams argue for their priorities with business justification
- Finding synergies (shared design system, CDN benefits multiple teams)
- Formal proposal via `_consensus` with quorum voting

---

### 2. Server Capacity (Emergency)

**Scenario**: Black Friday traffic spike. 3 services compete for 10 emergency server slots.

```bash
./scripts/demos/server-capacity.sh
```

**Features**:
- Time-pressured negotiation
- Direct revenue vs operational stability trade-offs
- One service (Analytics) positioned to sacrifice for the team

---

### 3. Sprint Planning

**Scenario**: 50 story points available, 85 requested. Product Lead facilitates.

```bash
./scripts/demos/sprint-planning.sh
```

**Features**:
- Facilitator reveals constraints (mandatory items)
- OKR-driven arguments
- Feature dependencies and synergies

---

## Running Any Demo

### Step 1: Start Relay Daemon

```bash
# Terminal 1
agent-relay up --dashboard --port 3888
```

Open http://localhost:3888 to watch the conversation in real-time.

### Step 2: Run Setup Script

```bash
# Any terminal
./scripts/demos/budget-negotiation.sh  # or others
```

This creates instruction files in `/tmp/agent-relay-*-demo/`.

### Step 3: Start Agents

```bash
# Terminal 2 (Facilitator)
agent-relay -n Frontend claude
# Say: Read /tmp/agent-relay-budget-demo/budget-context.md and /tmp/agent-relay-budget-demo/frontend-role.md then start the negotiation

# Terminal 3
agent-relay -n Backend claude
# Say: Read /tmp/agent-relay-budget-demo/budget-context.md and /tmp/agent-relay-budget-demo/backend-role.md then participate

# Terminal 4
agent-relay -n Infra claude
# Say: Read /tmp/agent-relay-budget-demo/budget-context.md and /tmp/agent-relay-budget-demo/infra-role.md then participate
```

## What You'll See

### In the Dashboard

- **Agents panel**: All three agents connect and show as active
- **Messages panel**: Real-time message flow between agents
- **Consensus proposals**: Formal proposals and votes appear

### In the Agent Terminals

1. Facilitator broadcasts welcome and explains the process
2. Each agent shares their priorities and arguments
3. Discussion with challenges and synergy discovery
4. Formal proposal created via `_consensus`
5. Each agent votes (approve/reject)
6. Consensus engine announces result (approved/rejected)

## Consensus System

The demos use the built-in consensus engine:

**Creating a Proposal**:
```bash
cat > $AGENT_RELAY_OUTBOX/propose << 'EOF'
TO: _consensus

PROPOSE: Proposal Title
TYPE: quorum
PARTICIPANTS: Agent1, Agent2, Agent3
QUORUM: 2
TIMEOUT: 300000

Description of what's being proposed.
EOF
```
Then output: `->relay-file:propose`

**Voting**:
```bash
cat > $AGENT_RELAY_OUTBOX/vote << 'EOF'
TO: _consensus
PROPOSAL: prop_xxxxxxx
VOTE: approve

Reasoning for the vote.
EOF
```
Then output: `->relay-file:vote`

**Consensus Types**:
- `majority` - >50% agree
- `quorum` - Minimum participation + majority
- `supermajority` - 2/3 threshold
- `unanimous` - All must agree

## Customization

Edit the role files to:
- Change resource amounts
- Add new constraints
- Modify negotiation strategies
- Create different personas (aggressive vs collaborative)

## Troubleshooting

**Agents not receiving messages?**
- Ensure daemon is running: `agent-relay up --dashboard`
- Check agents are connected in dashboard

**Consensus not working?**
- Ensure proposal has correct `TYPE`, `PARTICIPANTS`, `QUORUM` fields
- Check proposal ID matches in vote messages

**Demo not starting?**
- Run `agent-relay --version` to verify installation
- Run setup script first to create instruction files
