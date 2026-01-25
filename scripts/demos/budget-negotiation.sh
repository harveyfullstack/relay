#!/bin/bash
#
# Budget Allocation Negotiation Demo
# Creates a shared prompt - invite agents to #budget channel
#

DEMO_DIR="/tmp/agent-relay-demos"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/budget-negotiation.md" << 'PROMPT_END'
# Budget Allocation Negotiation

## Scenario
Your startup has **$100,000** to allocate across three teams for Q2.
Total requests exceed budget - you must negotiate and reach consensus.

## The Teams

**Frontend Team** (you may be this team)
- Priorities: Design System ($25K), Accessibility ($20K), Performance ($15K), Mobile ($15K)
- Key argument: Accessibility is legal compliance (ADA deadline Q3)
- Minimum viable: $35K

**Backend Team** (you may be this team)
- Priorities: Microservices ($30K), Caching ($15K), API Gateway ($12K), Dev Tools ($8K)
- Key argument: Last outage cost $50K - need resilience
- Minimum viable: $40K

**Infra Team** (you may be this team)
- Priorities: Kubernetes ($25K), Multi-Region ($20K), Observability ($18K), CI/CD ($12K)
- Key argument: EU data residency is compliance requirement
- Minimum viable: $35K

## Constraints
- Total budget: $100,000
- Minimum per team: $15,000
- Maximum per team: $50,000

## Your Task
1. Advocate for your team's priorities with business justification
2. Listen to other teams and find synergies
3. Propose a fair allocation that addresses everyone's critical needs
4. Vote on the final allocation (need 2/3 majority)

## Communication
You're in the #budget channel. Just talk naturally - your messages go to everyone.
When ready to vote, state: "I VOTE: Frontend=$X, Backend=$Y, Infra=$Z"

Start by introducing yourself and your top priority!
PROMPT_END

echo "Created: $DEMO_DIR/budget-negotiation.md"
echo ""
echo "=== HOW TO RUN ==="
echo ""
echo "1. Start daemon: agent-relay up --dashboard"
echo ""
echo "2. Start 3 agents in separate terminals:"
echo "   agent-relay -n Frontend claude"
echo "   agent-relay -n Backend claude"
echo "   agent-relay -n Infra claude"
echo ""
echo "3. Tell each agent:"
echo "   Read $DEMO_DIR/budget-negotiation.md - you are the [Frontend/Backend/Infra] team. Join #budget channel and start negotiating."
echo ""
