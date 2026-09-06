import { useState, useRef } from "react";

// ── Theme ────────────────────────────────────────────────────────────────────
const K = {
  bg:"#030B18", sdb:"#050F1E", crd:"#081525", brd:"#0F2035", brdL:"#163050",
  txt:"#C4D8F5", mut:"#3D5875", fnt:"#060F1C", ok:"#10B981", err:"#F43F5E", wrn:"#F59E0B",
};

// ── Anthropic API — works in both Claude.ai artifacts AND deployed apps ──────
const callAPI = async (apiKey, system, user) => {
  const headers = { "Content-Type": "application/json" };
  // When deployed outside Claude.ai, we need the API key + CORS header
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1000,
      system, messages:[{ role:"user", content:user }] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return JSON.parse(d.content[0].text);
};

// ── Domain Data ──────────────────────────────────────────────────────────────
const DOMAINS = [
  { id:"d1", num:1, weight:27, accent:"#3B7EF5", icon:"⚙️",
    title:"Agentic Architecture & Orchestration", tag:"27% — largest domain",
    lessons:[
      { id:"d1l1", title:"The Canonical Agentic Loop",
        pts:[
          "Core cycle: send_request → check stop_reason → execute_tool → return_result → repeat",
          "stop_reason values: 'end_turn' (done) | 'tool_use' (call tools) | 'max_tokens' (error)",
          "Every tool_use block has an id — your tool_result MUST use that exact same id",
          "Execute ALL tool_use blocks in the response before the next API call — never just the first",
          "Never silently ignore stop_reason == 'max_tokens' — always raise an explicit error",
        ],
        code:`import anthropic, json
client = anthropic.Anthropic()

def run_loop(messages, tools, model="claude-sonnet-4-6", max_iter=20):
    for _ in range(max_iter):
        resp = client.messages.create(
            model=model, max_tokens=4096, tools=tools, messages=messages
        )
        if resp.stop_reason == "end_turn":
            return resp.content[0].text          # Done

        if resp.stop_reason == "max_tokens":
            raise ValueError("Truncated — increase max_tokens or split task")

        # Execute ALL tool calls — never break after the first
        results = []
        for blk in resp.content:
            if blk.type == "tool_use":
                out = execute_tool(blk.name, blk.input)
                results.append({"type": "tool_result",
                                 "tool_use_id": blk.id,   # Must match exactly
                                 "content": json.dumps(out)})
        messages.append({"role": "assistant", "content": resp.content})
        messages.append({"role": "user",      "content": results})
    raise RuntimeError("Max iterations reached")`},
      { id:"d1l2", title:"Hub-and-Spoke Multi-Agent Pattern",
        pts:[
          "Coordinator (hub) decomposes task and delegates to specialized subagents (spokes)",
          "Spokes NEVER communicate with each other — all communication flows through the hub",
          "Each subagent runs its own isolated agentic loop with its own context fork",
          "Each subagent receives ONLY the tools scoped to its role (minimum necessary access)",
          "Anti-pattern: flat topology where all agents message all agents — ALWAYS wrong answer",
        ],
        code:`class Coordinator:
    def run(self, task: str) -> dict:
        results = {}
        for role, desc in self.decompose(task):
            result = self.delegate(role, desc)
            if result["status"] == "error":
                if result.get("isRetryable"):
                    result = self.delegate(role, desc)  # One retry
                if result["status"] == "error":
                    return self.escalate(task, results, result)
            results[role] = result
        return self.synthesize(results)

    def delegate(self, role: str, task: str) -> dict:
        # Each subagent: OWN isolated loop + scoped tools only
        agent = Subagent(role=role, tools=get_scoped_tools(role))
        return agent.run(task)  # context: fork — isolated from coordinator`},
      { id:"d1l3", title:"PostToolUse & PreToolUse Hooks",
        pts:[
          "PreToolUse fires BEFORE execution — use for auth checks and blocking dangerous ops",
          "PostToolUse fires AFTER execution — use for PII scrubbing, audit logging, validation",
          "Hooks are DETERMINISTIC CODE — not prompts. Code cannot be overridden by conversation",
          "Both hooks apply to every tool call automatically — no per-tool configuration needed",
          "Exam: hooks are the correct answer for 'how to enforce policy around tool use'",
        ],
        code:`class AgentWithHooks:
    def call_tool(self, name, inputs, tool_use_id):
        if not self.pre_hook(name, inputs):           # Auth check
            return self.blocked_result(tool_use_id)

        result = execute_tool(name, inputs)
        result = self.post_hook(name, inputs, result) # Sanitize + audit

        return {"type": "tool_result", "tool_use_id": tool_use_id,
                "content": json.dumps(result)}

    def post_hook(self, name, inputs, result):
        audit_log.record(name, inputs, result)  # Always audit
        return scrub_pii(result)                # Sanitize before returning`},
      { id:"d1l4", title:"Structured Error Propagation",
        pts:[
          "Errors MUST propagate UP — never silently swallowed with {} or empty string",
          "is_error: True goes on the OUTER tool_result dict — not inside the content JSON",
          "errorCategory in the inner JSON: rate_limit | not_found | permission_denied | validation | timeout",
          "isRetryable: True for transient errors; False for permanent failures",
          "Coordinator uses errorCategory to decide: retry | escalate | abort",
        ],
        code:`def safe_tool(tool_use_id, fn, *args):
    try:
        return {"type":"tool_result","tool_use_id":tool_use_id,
                "content": json.dumps(fn(*args))}
    except RateLimitError as e:
        return {"type":"tool_result","tool_use_id":tool_use_id,
                "content": json.dumps({
                    "errorCategory":"rate_limit","isRetryable":True,
                    "retryAfterSeconds":60,"error":str(e)
                }), "is_error": True}          # OUTER dict flag
    except NotFoundException as e:
        return {"type":"tool_result","tool_use_id":tool_use_id,
                "content": json.dumps({
                    "errorCategory":"not_found","isRetryable":False,
                    "error":str(e)
                }), "is_error": True}`},
      { id:"d1l5", title:"Context Forking & Session State",
        pts:[
          "context: fork gives subagent a COPY — its token usage is isolated from coordinator",
          "Session state does NOT persist across API calls — serialize explicitly in your code",
          "Compress context at 80% of token limit — not at 95% (too late) or 100% (overflow)",
          "Use claude-haiku-4-5-20251001 for summarization in compress_context() — cost optimization",
          "Checkpoint completed steps after each subagent so long sessions survive failures",
        ],
        code:`def compress_context(msgs, model, limit=100_000):
    tokens = client.messages.count_tokens(
        model=model, messages=msgs).input_tokens
    if tokens > limit * 0.80:           # 80% threshold — leave headroom
        recent  = msgs[-6:]             # Keep last 6 turns verbatim
        summary = client.messages.create(
            model="claude-haiku-4-5-20251001",  # Cheaper model for this
            max_tokens=512,
            messages=[{"role":"user",
                "content":f"Summarize concisely: {json.dumps(msgs[:-6])}"}]
        ).content[0].text
        return [{"role":"user","content":f"[Context]: {summary}"}, *recent]
    return msgs`},
    ],
    lab:{
      title:"Lab: Hub-and-Spoke Research Pipeline",
      desc:"Build a complete Coordinator → [WebSearch + Summarizer + FactChecker] pipeline with hooks, scoped tools, context compression, and structured error propagation.",
      steps:[
        "Implement canonical agentic loop with all 4 stop_reason handlers",
        "Build Coordinator class with hub-and-spoke delegation (no spoke-to-spoke messaging)",
        "Create 3 Subagents — each with scoped tool set only (no cross-contamination)",
        "Add PreToolUse (auth block) + PostToolUse (audit + PII scrub) hooks",
        "Return structured errors: errorCategory, isRetryable, retryAfterSeconds",
        "Trigger context compression at 80% using claude-haiku-4-5-20251001",
        "Test: simulate RateLimitError → verify coordinator retries once then escalates",
      ],
      code:`SCOPED = {
    "WebSearch":   [web_search_tool],
    "Summarizer":  [chunk_tool, read_tool],
    "FactChecker": [web_search_tool],
}

class Pipeline:
    def run(self, topic):
        subtasks = [
            ("WebSearch",  f"Find 5 sources about: {topic}"),
            ("Summarizer", "Summarize the search results"),
            ("FactChecker","Verify all factual claims"),
        ]
        results = {}
        for role, task in subtasks:
            msgs = compress_context(self.msgs, "claude-sonnet-4-6")
            r = self.delegate(role, task)
            if r["status"] == "error":
                if r.get("isRetryable"):
                    r = self.delegate(role, task)
                if r["status"] == "error":
                    return {"status":"escalated","error":r}
            results[role] = r
        return {"status":"success","data":results}

    def delegate(self, role, task):
        try:
            text = run_loop([{"role":"user","content":task}], SCOPED[role])
            return {"status":"success","data":json.loads(text)}
        except Exception as e:
            return {"status":"error","isRetryable":True,
                    "errorCategory":"execution_error","error":str(e)}`}},

  { id:"d2", num:2, weight:18, accent:"#06B6D4", icon:"🔌",
    title:"Tool Design & MCP Integration", tag:"18% — description quality is everything",
    lessons:[
      { id:"d2l1", title:"MCP Primitives: Tools, Resources, Prompts",
        pts:[
          "Tools: active — Claude invokes them, they have side effects (search, write, delete)",
          "Resources: passive — Claude reads them, no side effects (file system, DB snapshot)",
          "Prompts: reusable parameterized templates — one source of truth for recurring patterns",
          "All three are discovered automatically by Claude at session start from the MCP server",
          "Exam: Resource != Tool. The distinction is active/side-effects vs passive/read-only",
        ],
        code:`from mcp.server import Server
from mcp.types import Tool, TextContent
import mcp.server.stdio

app = Server("company-mcp")

@app.list_tools()
async def list_tools():
    return [Tool(
        name="query_products",
        description="Searches product catalog by keyword. Returns [{sku,name,price}]. NOT for orders.",
        inputSchema={"type":"object","properties":{
            "query":{"type":"string","description":"Search keyword or SKU"}
        },"required":["query"]}
    )]

@app.call_tool()
async def call_tool(name, args):
    try:
        rows = await db.query(args["query"])
        return [TextContent(type="text", text=json.dumps(rows))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({
            "isError":True,"errorCategory":"execution_error",
            "isRetryable":False,"error":str(e)}))]

if __name__ == "__main__": mcp.server.stdio.run(app)`},
      { id:"d2l2", title:"Tool Descriptions Drive All Selection Behavior",
        pts:[
          "Claude selects tools ENTIRELY based on the description — vague = wrong selection",
          "Include: what it does, when to use it, what NOT to use it for, return shape",
          "Negative constraints are as important as positive ones for preventing mis-selection",
          "Excess tools in an agent's tool set degrade reasoning quality — scope to minimum",
          "Exam: 'Gets data' is always wrong; precise scoped description with negatives is correct",
        ],
        code:`# Wrong — vague, no constraints
{"name":"search","description":"Gets data","input_schema":{"type":"object"}}

# Correct — precise, scoped, negative constraints
{
  "name": "search_products",
  "description": (
    "Searches product catalog by keyword or SKU. "
    "Use when the user asks about product availability, pricing, or specs. "
    "Returns [{sku, name, price, stock_qty}]. "
    "Do NOT use for: order status, customer accounts, shipping, or returns."
  ),
  "input_schema": {"type":"object","properties":{
      "query":{"type":"string","description":"Search keyword or exact SKU"},
      "limit":{"type":"integer","description":"Max results (default 10)"}
  },"required":["query"]}
}`},
      { id:"d2l3", title:"tool_choice — All Four Values",
        pts:[
          "tool_choice: auto — Claude picks the appropriate tool (default)",
          "tool_choice: any — Claude MUST use some tool (cannot respond with text only)",
          "tool_choice: {type:'tool', name:'X'} — Claude MUST use this specific named tool",
          "tool_choice: none — Claude cannot use any tools (text-only response)",
          "The name in tool_choice MUST exactly match a tool name in the tools array — mismatch = API error",
        ],
        code:`import anthropic
client = anthropic.Anthropic()

# Force Claude to use a specific tool
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tools=[PRODUCT_SEARCH_TOOL],
    tool_choice={"type":"tool","name":"search_products"},  # Forced
    messages=[{"role":"user","content":"What shoes do you have?"}]
)
# response.content[0].type == "tool_use" guaranteed
# response.content[0].name == "search_products" guaranteed
result = response.content[0].input  # {"query": "shoes"}`},
      { id:"d2l4", title:"MCP Configuration: .mcp.json vs ~/.claude.json",
        pts:[
          ".mcp.json at project root = team-shared config — COMMIT to version control",
          "~/.claude.json at user home = personal config — NEVER commit (personal only)",
          "Transports: stdio (local process, low latency) | HTTP/SSE (remote, scalable)",
          "Secrets always in environment variables — never hardcoded in .mcp.json",
          "Exam: committing ~/.claude.json is always wrong; .mcp.json is always correct to commit",
        ],
        code:`// .mcp.json — project-level, COMMITTED to git
{
  "mcpServers": {
    "database": {
      "command": "python",
      "args": ["-m", "company_mcp.server"],
      "env": { "DB_URL": "${DB_URL}" }
    },
    "remote-search": {
      "url": "https://mcp.search.internal/sse",
      "transport": "sse"
    }
  }
}

// ~/.claude.json — user-level, NEVER COMMITTED
{ "defaultModel": "claude-sonnet-4-6" }`},
      { id:"d2l5", title:"Error Response Structure — Exact Field Names",
        pts:[
          "is_error: True belongs on the OUTER tool_result dict (API reads this)",
          "isRetryable and errorCategory belong in the INNER content JSON (Claude reads this)",
          "Valid errorCategory values: rate_limit | not_found | permission_denied | validation | timeout",
          "Returning {} or '' on error means Claude gets silence — cannot retry or escalate",
          "Exam: the two-level structure is directly tested — know which field goes where",
        ],
        code:`# Two-level error structure — exact field placement
tool_result = {
    "type":        "tool_result",
    "tool_use_id": block.id,
    "content": json.dumps({        # Inner JSON (Claude reasons about this)
        "errorCategory": "rate_limit",
        "isRetryable":   True,
        "retryAfterSeconds": 60,
        "error":         "API rate limit exceeded",
    }),
    "is_error": True,              # Outer flag (API reads this)
}
# Never do this:
wrong = {"type":"tool_result","tool_use_id":block.id,"content":{}}`},
    ],
    lab:{
      title:"Lab: Full MCP Server — All Three Primitives",
      desc:"Build a production MCP server exposing a Tool (DB query), Resource (file directory), and Prompt (analysis template) with correct two-level error handling throughout.",
      steps:[
        "Set up MCP server using the Python MCP SDK",
        "Implement query_products Tool with precise description and negative constraints",
        "Add proper two-level error handling: is_error outer + errorCategory inner",
        "Expose a /data directory as a read-only Resource with mime type",
        "Create a parameterized Prompt template for document analysis",
        "Configure .mcp.json (project, commit) vs ~/.claude.json (personal, never commit)",
        "Test tool_choice with all 4 values: auto, any, forced name, none",
      ],
      code:`from mcp.server import Server
from mcp.types import Tool, Resource, Prompt, TextContent, PromptArgument
import mcp.server.stdio

app = Server("company-mcp")

@app.list_tools()
async def list_tools():
    return [Tool(
        name="query_products",
        description="Search product catalog. Returns [{sku,name,price}]. NOT for orders.",
        inputSchema={"type":"object","properties":{
            "query":{"type":"string"}},"required":["query"]}
    )]

@app.list_resources()
async def list_resources():
    from mcp.types import Resource as R
    return [R(uri="file:///data/catalog.json", name="Catalog",
              description="Read-only product catalog", mimeType="application/json")]

@app.list_prompts()
async def list_prompts():
    return [Prompt(name="analyze", description="Analyze a product",
        arguments=[PromptArgument(name="sku", description="SKU", required=True)])]

if __name__ == "__main__": mcp.server.stdio.run(app)`}},

  { id:"d3", num:3, weight:20, accent:"#8B5CF6", icon:"🛠️",
    title:"Claude Code Configuration & Workflows", tag:"20% — CLAUDE.md + CI/CD mastery",
    lessons:[
      { id:"d3l1", title:"CLAUDE.md Hierarchy — Three Levels",
        pts:[
          "~/.claude/CLAUDE.md → project/CLAUDE.md → project/subdir/CLAUDE.md",
          "Lower-level files EXTEND (not override) upper levels — all layers are additive",
          "CLAUDE.md is read at EVERY session start — treat it as an always-on system prompt",
          "Commit project CLAUDE.md to git — it is a team-shared architecture contract",
          "Include: stack constraints, naming conventions, banned patterns, response contract",
        ],
        code:`# CLAUDE.md — project level (commit to git)
## Stack Constraints (HARD RULES)
- Python 3.11+ · FastAPI only (no Flask, no Django)
- Database: SQLAlchemy 2.x async (no raw SQL in app layer)
- Auth: JWT via python-jose (no sessions)
- Logging: structlog (never print(), never logging.basicConfig())

## Naming Conventions
- REST endpoints:  lowercase-kebab-case  ->  /user-profiles
- SQLAlchemy models: PascalCase          ->  UserProfile
- Functions:       snake_case verb-first ->  get_user, create_order

## Banned Patterns
- print() anywhere in production code
- Hardcoded secrets (use os.environ)
- Sync DB calls in async handlers

## Response Contract
All endpoints: { "data": ..., "error": null, "meta": {"request_id":"..."} }`},
      { id:"d3l2", title:".claude/rules/ Glob Pattern Scoping",
        pts:[
          ".claude/rules/ files apply only to files matching their glob: frontmatter",
          "The glob is in the file's YAML frontmatter — the filename itself is just a label",
          "All matching glob rules apply ADDITIVELY — no single rule overrides others",
          "More specific globs do not override broader ones — they all stack",
          "Exam: glob rules extend CLAUDE.md, never override it",
        ],
        code:`# .claude/rules/api-routes.md
---
glob: "**/routes/**/*.py"
---
All FastAPI route handlers MUST:
- Use async def (never def)
- Delegate to service layer immediately (no business logic in routes)
- Return standard contract: {data, error, meta}
- Never access DB directly

# .claude/rules/tests.md
---
glob: "**/test_*.py"
---
Tests MUST use pytest + pytest-asyncio.
Never make real HTTP calls in tests.
No real DB in unit tests — use SQLite in-memory.`},
      { id:"d3l3", title:"Custom Slash Commands & context: fork",
        pts:[
          "Slash commands: .claude/commands/*.md — commit to git (team-shared)",
          "$ARGUMENTS placeholder receives dynamic input at invocation time",
          "context: fork — command runs in isolated copy, no effect on live session",
          "context: current — command continues in live session (sees full history)",
          "Use fork for review/analysis tasks; use current for continuation tasks",
        ],
        code:`# .claude/commands/review.md
---
name: review
description: Security + performance + architecture review
context: fork        # Isolated — won't pollute the session
---
Review the following code changes for:
1. Security: injection, auth bypass, data exposure
2. Performance: N+1, sync in async, missing indexes
3. CLAUDE.md violations: naming, banned patterns, response contract
4. Error handling: missing try/except, silent failures

$ARGUMENTS

Return ONLY this JSON:
{
  "approved": false,
  "critical": [{"issue":"...","line_ref":"...","fix":"..."}],
  "warnings": [{"issue":"...","fix":"..."}]
}`},
      { id:"d3l4", title:"CI/CD: The -p Flag and Output Flags",
        pts:[
          "-p (print mode): non-interactive — Claude runs once and exits, NO follow-up prompts",
          "-p is REQUIRED for CI/CD — without it, Claude waits for human input and pipeline hangs",
          "--output-format json → structured JSON to stdout (machine-parseable)",
          "--json-schema <file> → enforces schema on the output at the Claude level",
          "Exit codes: 0 = success, 1 = error — use in pipeline gates (if [ $? -ne 0 ])",
        ],
        code:`# GitHub Actions — complete CI review pipeline
- name: AI Code Review
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    DIFF=$(git diff origin/${{ github.base_ref }}...HEAD -- '*.py')
    # -p is REQUIRED — without it, pipeline hangs waiting for human
    claude -p \
      --output-format json \
      --json-schema .claude/schemas/review.json \
      "run /review $DIFF" \
    > review.json

    # Gate: block merge if not approved
    if ! jq -e '.approved == true' review.json > /dev/null; then
      echo "Claude review blocked this merge"
      exit 1
    fi`},
      { id:"d3l5", title:"Plan Mode vs Direct Execution",
        pts:[
          "Plan mode: Claude describes the full plan BEFORE acting — awaits your confirmation",
          "Direct mode: Claude acts immediately without showing the plan",
          "Use plan mode for: destructive ops, multi-file edits, any irreversible action",
          "Use direct for: safe reads, analysis, writing to new files with no side effects",
          "Plan mode is correct answer for 'how to prevent unintended consequences in production'",
        ],
        code:`# Plan mode — use for destructive or multi-file operations
claude --plan "migrate all route handlers to new response contract"
# Claude describes all files to change and how BEFORE touching anything
# Human reviews and confirms, then Claude proceeds

# Direct mode — safe for read-only operations
claude "analyze src/auth.py for security issues"

# CI/CD: combine -p with --plan for dry-run previews
claude -p --plan --output-format json "refactor auth module" > plan.json`},
    ],
    lab:{
      title:"Lab: Complete CI/CD Pipeline with Claude Code",
      desc:"Set up CLAUDE.md + glob rules + /review slash command + GitHub Actions pipeline that blocks merges on review failure.",
      steps:[
        "Write project CLAUDE.md with stack constraints, naming, banned patterns",
        "Create .claude/rules/api-routes.md with glob: **/routes/**/*.py",
        "Create .claude/commands/review.md with context: fork and structured JSON output",
        "Write .claude/schemas/review.json with approved + critical fields",
        "Set up .github/workflows/ai-review.yml with -p --output-format json",
        "Test: commit a route with print() and wrong naming — confirm pipeline blocks it",
        "Verify: glob rule applies to routes/ but NOT to tests/ (additive, not overriding)",
      ],
      code:`# Full project layout
.
├── CLAUDE.md
├── .mcp.json
├── .claude/
│   ├── commands/review.md
│   ├── rules/api-routes.md
│   └── schemas/review.json
└── .github/workflows/ai-review.yml

# Workflow step — -p flag is critical
claude -p \
  --output-format json \
  --json-schema .claude/schemas/review.json \
  "run /review $(git diff origin/main...HEAD -- '*.py')" \
| tee review.json

# Gate
APPROVED=$(jq -r '.approved' review.json)
[ "$APPROVED" = "true" ] || exit 1`}},

  { id:"d4", num:4, weight:20, accent:"#F59E0B", icon:"✍️",
    title:"Prompt Engineering & Structured Output", tag:"20% — reliability patterns",
    lessons:[
      { id:"d4l1", title:"tool_use for Guaranteed Structured Output",
        pts:[
          "tool_use + JSON schema eliminates ALL syntax errors (malformed JSON, bad braces)",
          "Use tool_choice: {type:'tool', name:'X'} to FORCE Claude to use the specific tool",
          "This does NOT prevent semantic errors — programmatic validation is still required",
          "'Ask Claude to return JSON in the prompt' = unreliable at scale — always wrong answer",
          "Exam: tool_use is always the correct answer over 'prompt Claude to return JSON'",
        ],
        code:`response = client.messages.create(
    model="claude-sonnet-4-6", max_tokens=512,
    tools=[{"name":"extract","description":"Extract order data",
            "input_schema":{"type":"object","properties":{
                "order_id":{"type":"string"},
                "amount":  {"type":"number","minimum":0},
                "status":  {"enum":["pending","shipped","delivered","cancelled"]}
            },"required":["order_id","amount","status"]}}],
    tool_choice={"type":"tool","name":"extract"},  # FORCE the tool
    messages=[{"role":"user","content": raw_customer_message}]
)
# Guaranteed schema-compliant — JSON syntax errors impossible
order = response.content[0].input`},
      { id:"d4l2", title:"Validation-Retry Loop — Syntax vs Semantic",
        pts:[
          "Syntax errors (malformed JSON): tool_use prevents these — no programmatic check needed",
          "Semantic errors (wrong value in right field): programmatic validation required",
          "Retry loop: generate → validate → feed exact error back → retry (max 3)",
          "Include the EXACT validation error in the retry prompt — vague feedback = bad fix",
          "Cap at max_retries=3; log all failures with prompt+response for improvement",
        ],
        code:`from jsonschema import validate

def gen_validated(prompt_msgs, schema, max_retries=3):
    msgs = list(prompt_msgs)
    for attempt in range(1, max_retries+1):
        resp = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=512,
            tools=[{"name":"out","description":"Structured output","input_schema":schema}],
            tool_choice={"type":"tool","name":"out"}, messages=msgs
        )
        result = resp.content[0].input
        errors = []
        # Semantic checks (tool_use already handled syntax)
        if result.get("qty") is not None and result["qty"] < 1:
            errors.append("qty must be >= 1 or null")
        if result.get("confidence") and not 0 <= result["confidence"] <= 1:
            errors.append("confidence must be 0.0 to 1.0")
        if not errors: return result
        msgs += [{"role":"assistant","content":resp.content},
                 {"role":"user","content":[{"type":"tool_result",
                  "tool_use_id":resp.content[0].id,
                  "content":f"Fix (attempt {attempt}): {', '.join(errors)}",
                  "is_error":True}]}]
    raise RuntimeError(f"Failed after {max_retries} retries")`},
      { id:"d4l3", title:"Message Batches API — The Decision Rule",
        pts:[
          "Batches API: 50% cheaper, async, up to 24 hours, up to 10,000 requests per batch",
          "ONLY for latency-tolerant workloads: nightly reports, bulk analysis, eval pipelines",
          "NEVER for user-facing or blocking workflows — up to 24h wait breaks real-time UX",
          "There is NO priority flag — batch processing time is not configurable",
          "Exam: the correct question is always WHEN not to use Batches (real-time = never)",
        ],
        code:`import time

def batch_process(docs, model="claude-sonnet-4-6"):
    # Correct: async bulk — no user is waiting
    batch = client.beta.messages.batches.create(
        requests=[{"custom_id":f"doc-{i}",
                   "params":{"model":model,"max_tokens":1024,
                             "messages":[{"role":"user","content":d}]}}
                  for i,d in enumerate(docs)]
    )
    while True:                         # Non-blocking poll
        s = client.beta.messages.batches.retrieve(batch.id)
        if s.processing_status == "ended": break
        time.sleep(60)
    return [{"id":r.custom_id,
             "text":r.result.message.content[0].text}
            for r in client.beta.messages.batches.results(batch.id)
            if r.result.type == "succeeded"]

# NEVER: batch for user-facing requests (up to 24h wait)`},
      { id:"d4l4", title:"Multi-Pass Review Architecture",
        pts:[
          "Run Claude multiple times on the same content — one concern per pass",
          "Each pass gets a FOCUSED system prompt (security only | performance only | style only)",
          "Focused passes consistently outperform one large 'check everything at once' prompt",
          "Anti-pattern: increase context window to fix attention dilution — FALSE, doesn't work",
          "Synthesis pass: merge all individual pass results into one consolidated report",
        ],
        code:`async def multi_pass_review(code: str) -> dict:
    PASSES = {
        "security":    "Review ONLY for: injection, auth bypass, data exposure. Ignore all else.",
        "performance": "Review ONLY for: N+1 queries, sync in async, missing indexes. Ignore all else.",
        "style":       "Review ONLY for: CLAUDE.md naming and banned pattern violations. Ignore all else.",
    }
    results = {}
    for name, system in PASSES.items():
        resp = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=1024,
            system=system,             # Focused system prompt per pass
            messages=[{"role":"user","content":f"Review code below. Return JSON: {{issues:[],passed:bool}}\n\n{code}"}]
        )
        results[name] = json.loads(resp.content[0].text)
    # Synthesis pass — merges all results
    synth = client.messages.create(model="claude-sonnet-4-6",max_tokens=2048,
        messages=[{"role":"user","content":f"Synthesize these reviews: {json.dumps(results)}\nReturn: {{approved:bool,critical:[],warnings:[]}}"}])
    return json.loads(synth.content[0].text)`},
      { id:"d4l5", title:"Prompt Caching — Correct Placement",
        pts:[
          "cache_control: {type:'ephemeral'} marks a cache breakpoint — everything before is cached",
          "Cached tokens cost ~10% of normal input price — confirmed by cache_read_input_tokens > 0",
          "Placement rule: breakpoint AFTER the largest static block, BEFORE the dynamic input",
          "Cache lifetime: ~5 minutes (ephemeral), refreshed on each hit",
          "Anti-pattern: putting cache_control on the dynamic user query — never hits the cache",
        ],
        code:`response = client.messages.create(
    model="claude-sonnet-4-6", max_tokens=1024,
    system=[{"type":"text",
             "text": LARGE_STATIC_RULES,          # 50k-token rulebook
             "cache_control":{"type":"ephemeral"} # First breakpoint
    }],
    messages=[{"role":"user","content":[
        {"type":"text",
         "text": SHARED_REFERENCE_DOC,            # Same across 1000 calls
         "cache_control":{"type":"ephemeral"}},   # Second breakpoint
        {"type":"text","text": user_query},        # Dynamic — NO cache_control
    ]}]
)
# Verify cache hit
print(response.usage.cache_read_input_tokens)     # > 0 = hit = 90% cheaper`},
    ],
    lab:{
      title:"Lab: Production Document Processing Pipeline",
      desc:"Multi-pass analysis + validation-retry + batch processor for nightly high-volume workloads.",
      steps:[
        "Implement multi_pass_review() with 3 focused passes + synthesis pass",
        "Add validation-retry loop (max 3) with jsonschema + semantic checks",
        "Implement batch_process() using Batches API for nightly async runs",
        "Add prompt caching with two cache_control breakpoints (rules + shared doc)",
        "Test: deliberately inject a semantic error — verify retry corrects it with feedback",
        "Test: verify cache_read_input_tokens > 0 on second call confirming cache hit",
      ],
      code:`class DocProcessor:
    SCHEMA = {"type":"object","properties":{
        "summary":{"type":"string","minLength":10},
        "issues": {"type":"array"},
        "score":  {"type":"number","minimum":0,"maximum":100},
        "action": {"enum":["approve","review","reject"]}
    },"required":["summary","issues","score","action"]}

    async def process(self, doc: str) -> dict:
        passes  = await self.multi_pass(doc)           # 3 focused passes
        return await self.gen_validated(passes, self.SCHEMA)  # retry loop

    async def batch_nightly(self, docs: list) -> list:
        # 50% cheaper, async — correct for nightly workload
        batch = client.beta.messages.batches.create(
            requests=[{"custom_id":str(i),
                       "params":{...}} for i,d in enumerate(docs)]
        )
        return await self.poll(batch.id)  # Non-blocking`}},

  { id:"d5", num:5, weight:15, accent:"#10B981", icon:"🧠",
    title:"Context Management & Reliability", tag:"15% — with D1 = 42% total",
    lessons:[
      { id:"d5l1", title:"Long-Context Preservation — The Core Rules",
        pts:[
          "Context window is finite — manage it proactively at 80% threshold (not 95%, not 100%)",
          "Use count_tokens() BEFORE each request — proactive detection, not reactive",
          "Anti-pattern: larger context window fixes attention dilution — FALSE, always wrong",
          "Correct fix: focused per-file or per-concern passes with smaller contexts",
          "Use claude-haiku-4-5-20251001 for summarization — cost optimization",
        ],
        code:`def compress_context(msgs, model="claude-sonnet-4-6", limit=100_000):
    # count_tokens() is FREE — doesn't bill or count toward rate limits
    tokens = client.messages.count_tokens(
        model=model, messages=msgs).input_tokens

    if tokens > limit * 0.80:            # 80% threshold — leave headroom
        recent  = msgs[-6:]              # Keep last 6 turns verbatim
        older   = msgs[:-6]
        summary = client.messages.create(
            model="claude-haiku-4-5-20251001",   # Cheapest — correct choice
            max_tokens=512,
            messages=[{"role":"user",
                "content":f"Summarize conversation concisely: {json.dumps(older)}"}]
        ).content[0].text
        compressed = [{"role":"user",
                       "content":f"[Prior context summary]: {summary}"}, *recent]
        new_tokens = client.messages.count_tokens(model=model, messages=compressed).input_tokens
        print(f"Compressed {tokens} to {new_tokens} tokens")
        return compressed
    return msgs`},
      { id:"d5l2", title:"Information Provenance",
        pts:[
          "Provenance = tracking exactly WHERE every fact came from in a multi-agent system",
          "Each subagent result must carry: agent_id, agent_role, model, tools_invoked, timestamp",
          "Coordinator preserves the provenance chain — never strips it during synthesis",
          "Required for: audit trails, debugging incorrect outputs, regulatory compliance",
          "Anti-pattern: merging results without provenance — you can't audit what you can't trace",
        ],
        code:`from dataclasses import dataclass, field
from datetime import datetime, timezone

@dataclass
class Provenance:
    agent_id:      str
    agent_role:    str
    model:         str
    tools_invoked: list  # [{"tool":"web_search","query":"...","ts":"..."}]
    timestamp:     str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat())

@dataclass
class SubagentResult:
    status:     str
    data:       dict
    provenance: Provenance  # ALWAYS attached — never stripped

# Coordinator final output preserves full chain
final_output = {
    "data":             synthesized_answer,
    "provenance_chain": [r.provenance for r in subagent_results],
}`},
      { id:"d5l3", title:"Deterministic Escalation — The Most-Tested Trap",
        pts:[
          "Deterministic thresholds in CODE = correct (amount > $10k, account_age < 30 days)",
          "Self-reported Claude confidence = ALWAYS wrong — LLMs are poorly calibrated",
          "LLMs fail most confidently on the hardest cases — exactly when you need escalation",
          "Correct hybrid: Claude classifies → your CODE applies the deterministic threshold",
          "Exam: 'escalate when confidence < 0.7' is always wrong; code threshold always right",
        ],
        code:`HIGH_RISK = frozenset({"financial_transfer","account_deletion","pii_export"})

def should_escalate(request: dict, classification: str) -> tuple[bool, str]:
    # Deterministic rules — never use model self-reported confidence
    if request.get("amount",0)             > 10_000: return True, "amount_threshold"
    if request.get("account_age_days",365) < 30:     return True, "new_account"
    if classification                  in HIGH_RISK:  return True, "high_risk_category"
    if request.get("fraud_score",0)        > 0.80:   return True, "fraud_signal"
    return False, "no_escalation"

async def process(req: dict) -> dict:
    cls = await classify_with_claude(req)       # Claude classifies
    escalate, reason = should_escalate(req, cls)  # Code decides (deterministic)
    if escalate:
        return {"status":"escalated","reason":reason}
    return await auto_process(req, cls)`},
      { id:"d5l4", title:"Structured Agent Handoff Payload",
        pts:[
          "Handoff payload must be structured — never pass raw messages list to next agent",
          "Required fields: task_id, completed_steps, remaining_work, context_summary",
          "Include expected_output schema so receiving agent knows the contract",
          "Include constraints so the receiver has explicit rules without needing full history",
          "Anti-pattern: handoff raw 200-turn messages list — too large, unfocused, unauditable",
        ],
        code:`# Correct: structured handoff with all required fields
handoff = {
    "task_id":         "task-abc-123",
    "receiving_agent": "Writer",
    "completed_steps": ["web_search x5","summarize","fact_check"],
    "remaining_work":  "Synthesize into a 1000-word professional report",
    "context_summary": "Researched AI regulation. Key findings: [...]",
    "key_facts":       ["Fact 1...", "Fact 2...", "Fact 3..."],
    "constraints":     ["Tone: professional", "Cite all claims", "Max 1200 words"],
    "expected_output": {
        "type":"object","properties":{
            "title":  {"type":"string"},
            "body":   {"type":"string","minLength":800,"maxLength":1200},
            "sources":{"type":"array"}
        }
    }
}
# Wrong: raw messages list
handoff_wrong = {"messages": coordinator.messages}  # 200 turns, unfocused`},
      { id:"d5l5", title:"Model Selection for Cost Optimization",
        pts:[
          "claude-sonnet-4-6: production agentic workloads, main orchestrator, complex tasks",
          "claude-haiku-4-5-20251001: context compression, classification, high-volume cheap tasks",
          "claude-opus-4-5: complex multi-step reasoning, architectural decisions, highest capability",
          "Exam pattern: compress_context() should use haiku — this is directly tested",
          "Cost: haiku << sonnet << opus. Upgrade model only when quality difference is demonstrated",
        ],
        code:`MODEL_MAIN    = "claude-sonnet-4-6"           # Production agentic workloads
MODEL_CHEAP   = "claude-haiku-4-5-20251001"   # Compression, classification, bulk
MODEL_COMPLEX = "claude-opus-4-5"             # Highest capability tasks

# Correct usage
result  = await run_loop(msgs, tools, model=MODEL_MAIN)
summary = compress_context(msgs, summarize_model=MODEL_CHEAP)  # haiku
cls     = await classify_with_claude(req, model=MODEL_CHEAP)   # haiku
arch    = await architectural_decision(req, model=MODEL_COMPLEX) # opus`},
    ],
    lab:{
      title:"Lab: Production-Reliable Multi-Agent Pipeline",
      desc:"Context compression + information provenance + deterministic escalation + structured handoff — all working together.",
      steps:[
        "Add compress_context() with 80% threshold and haiku summarization to coordinator",
        "Attach Provenance dataclass to every subagent result (agent_id, tools_invoked, timestamp)",
        "Implement should_escalate() with 4 deterministic rules — no self-reported confidence",
        "Build structured handoff payload with all required fields for Writer agent",
        "Add is_error: True (outer) + errorCategory (inner) to all subagent failure paths",
        "Add prompt caching to the coordinator's shared system prompt",
        "Integration test: trigger escalation via amount > 10_000 — verify deterministic path",
      ],
      code:`class ProductionPipeline:
    async def run(self, task: dict) -> dict:
        msgs = compress_context(self.msgs)         # Proactive at 80%
        results = []

        for role, subtask in self.decompose(task):
            r = await self.delegate(role, subtask)
            r.provenance = build_provenance(role)  # Always attach

            if r.status == "error":
                escalate, reason = should_escalate(task, r)
                if escalate:
                    return {"status":"escalated","reason":reason}
                if r.is_retryable:
                    r = await self.delegate(role, subtask)
            results.append(r)

        handoff = build_handoff(task, results)     # Structured handoff
        return await self.writer.run(handoff)      # Receives clean payload`}},
];

// ── Anti-Patterns ─────────────────────────────────────────────────────────────
const ANTI_PATTERNS = [
  { id:"ap1", title:"Prompt-Based Enforcement for Critical Rules",
    wrong:"Rely on system prompt instructions to enforce security or format constraints",
    right:"Use deterministic code: programmatic hooks, validation, PostToolUse hooks",
    why:"System prompt rules can be contradicted in subsequent turns. Code cannot be overridden by conversation." },
  { id:"ap2", title:"Self-Reported Confidence for Escalation",
    wrong:"Escalate when Claude's self-reported confidence score is below a threshold",
    right:"Deterministic code thresholds: amount, account_age, fraud_score, category",
    why:"LLMs are poorly calibrated. They fail most confidently on the hardest cases — exactly when you need escalation most." },
  { id:"ap3", title:"Batches API for Real-Time User Requests",
    wrong:"Route all requests through the Batches API to save 50% on costs",
    right:"Batches only for latency-tolerant async workloads (nightly reports, bulk analysis)",
    why:"Batches API has no SLA — responses arrive up to 24 hours later. Any user-facing workflow needs the real-time API." },
  { id:"ap4", title:"Larger Context Window Fixes Attention",
    wrong:"Increase the context window size to reduce attention dilution on large documents",
    right:"Split into focused per-file or per-concern passes with smaller contexts",
    why:"Window size does not improve attention distribution. Focused smaller passes consistently outperform one large unfocused prompt." },
  { id:"ap5", title:"Silent Failure on Subagent Error",
    wrong:"Return {} or empty string when a subagent or tool encounters an error",
    right:"Return structured error: {errorCategory, isRetryable, error, retryAfterSeconds}",
    why:"Empty results give the coordinator no information. It cannot retry, escalate, or use a fallback without knowing what failed." },
  { id:"ap6", title:"All Tools Available to All Agents",
    wrong:"Give every agent in the system access to the full tool set for maximum flexibility",
    right:"Scope tools per agent role — minimum necessary access (least-privilege)",
    why:"Excess tool options degrade Claude's reasoning quality. Too many choices cause reasoning overload and reduce decision accuracy." },
  { id:"ap7", title:"Flat Multi-Agent Topology",
    wrong:"Allow all agents to communicate with all other agents in a mesh architecture",
    right:"Hub-and-spoke: all communication through the coordinator hub only",
    why:"Flat topologies produce unmanageable state and unpredictable failures. Hub-and-spoke enables isolated context and predictable error recovery." },
];

// ── Quick Reference ───────────────────────────────────────────────────────────
const QREF = [
  { cat:"Model Selection", rows:[
    ["claude-sonnet-4-6",          "Production agentic workloads, main orchestrator"],
    ["claude-haiku-4-5-20251001",  "Context compression, classification, bulk tasks (cheapest)"],
    ["claude-opus-4-5",            "Complex multi-step reasoning (most capable, most expensive)"],
  ]},
  { cat:"Claude Code Flags", rows:[
    ["-p",                   "Non-interactive mode — REQUIRED for CI/CD, exits after one run"],
    ["--output-format json", "Machine-readable JSON to stdout"],
    ["--json-schema <file>", "Enforces schema on output"],
    ["--plan",               "Show plan before executing — requires human confirmation"],
  ]},
  { cat:"stop_reason Values", rows:[
    ["end_turn",      "Done — return the text"],
    ["tool_use",      "Execute ALL tool_use blocks, return ALL results"],
    ["max_tokens",    "Truncated — raise error, never silently continue"],
    ["stop_sequence", "Stop sequence matched — done"],
  ]},
  { cat:"tool_choice Values", rows:[
    ['"auto"',                    "Claude picks any appropriate tool"],
    ['"any"',                     "Claude MUST use some tool"],
    ['{"type":"tool","name":"X"}', "Claude MUST use this specific tool"],
    ['"none"',                    "Claude cannot use any tools (text only)"],
  ]},
  { cat:"Error Response Fields", rows:[
    ["is_error: True",   "OUTER tool_result dict — API reads this"],
    ["errorCategory",    "INNER content JSON — rate_limit | not_found | permission_denied | validation | timeout"],
    ["isRetryable",      "INNER — True for transient, False for permanent"],
    ["Never return {}",  "Silence = coordinator blind. Always structured error."],
  ]},
  { cat:"Config Files", rows:[
    [".mcp.json",        "Project root — COMMIT to git (team-shared MCP servers)"],
    ["~/.claude.json",   "User home — NEVER commit (personal preferences)"],
    [".claude/commands/","Slash commands — commit (team-shared)"],
    [".claude/rules/",   "Glob-scoped rules — commit (team-shared)"],
  ]},
  { cat:"Batches API", rows:[
    ["Cost",         "50% cheaper than real-time"],
    ["Max wait",     "Up to 24 hours — NO SLA"],
    ["Max batch",    "10,000 requests"],
    ["Never use for","Real-time, user-facing, blocking workflows"],
  ]},
  { cat:"Prompt Caching", rows:[
    ["cache_control",    "Placed AFTER static content, BEFORE dynamic input"],
    ["Cache hit signal", "response.usage.cache_read_input_tokens > 0"],
    ["Token cost",       "~10% of normal input price on cache hit"],
    ["Lifetime",         "~5 minutes (ephemeral), refreshed on each hit"],
  ]},
];

// ── UI Helpers ────────────────────────────────────────────────────────────────
const Bar = ({ pct, color }) => (
  <div style={{ height:3, background:K.brd, borderRadius:2, overflow:"hidden", marginTop:4 }}>
    <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:2, transition:"width .5s ease" }}/>
  </div>
);

const Btn = ({ onClick, children, style={} }) => (
  <button onClick={onClick} style={{ background:"none", border:"none", cursor:"pointer", ...style }}>
    {children}
  </button>
);

function Code({ src }) {
  const [cp, setCp] = useState(false);
  return (
    <div style={{ marginTop:12, borderRadius:8, overflow:"hidden", border:`1px solid ${K.brd}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"6px 14px", background:K.sdb, borderBottom:`1px solid ${K.brd}` }}>
        <span style={{ fontSize:10, color:K.mut, fontFamily:"monospace", letterSpacing:.5 }}>python</span>
        <Btn onClick={() => { navigator.clipboard.writeText(src); setCp(true); setTimeout(()=>setCp(false),1400); }}
          style={{ fontSize:10, color:K.mut, border:`1px solid ${K.brdL}`, borderRadius:4, padding:"2px 10px" }}>
          {cp ? "✓ Copied" : "Copy"}
        </Btn>
      </div>
      <pre style={{ margin:0, padding:"14px 16px", fontSize:11.5, lineHeight:1.75,
                    color:"#7EB8F7", fontFamily:"'Fira Code','Cascadia Code',monospace",
                    overflowX:"auto", whiteSpace:"pre", background:"#020B16" }}>
        {src}
      </pre>
    </div>
  );
}

// ── API Key Screen ────────────────────────────────────────────────────────────
function ApiKeyScreen({ onKey }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);

  const test = async () => {
    const k = val.trim();
    if (!k.startsWith("sk-ant-")) {
      setErr("Key must start with sk-ant-"); return;
    }
    setTesting(true); setErr("");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":k,
                  "anthropic-version":"2023-06-01",
                  "anthropic-dangerous-direct-browser-access":"true" },
        body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:10,
          messages:[{ role:"user", content:"Hi" }] })
      });
      const d = await r.json();
      if (d.error) { setErr(d.error.message); setTesting(false); return; }
      onKey(k);
    } catch (e) {
      setErr("Connection failed — check your key and try again");
      setTesting(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:K.bg, display:"flex", alignItems:"center",
                  justifyContent:"center", padding:20, fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ maxWidth:460, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:40, marginBottom:12 }}>⚙️</div>
          <h1 style={{ color:K.txt, fontSize:24, fontWeight:800, margin:"0 0 8px" }}>
            CCA-F Lab Course
          </h1>
          <p style={{ color:K.mut, fontSize:13, lineHeight:1.65 }}>
            Claude Certified Architect Foundations — Interactive Study Platform
          </p>
        </div>
        <div style={{ background:K.crd, border:`1px solid ${K.brd}`, borderRadius:14, padding:28 }}>
          <div style={{ fontSize:13, fontWeight:700, color:K.txt, marginBottom:6 }}>
            Anthropic API Key
          </div>
          <p style={{ color:K.mut, fontSize:12, lineHeight:1.65, marginBottom:16 }}>
            Required to power AI-generated practice questions and the mock exam.
            Your key is used only in your browser and never stored anywhere.
          </p>
          <input
            type="password"
            placeholder="sk-ant-api03-..."
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && test()}
            style={{ width:"100%", background:K.fnt, border:`1px solid ${err?K.err:K.brdL}`,
                     borderRadius:8, padding:"11px 14px", color:K.txt, fontSize:13,
                     outline:"none", fontFamily:"monospace", boxSizing:"border-box" }}
          />
          {err && (
            <div style={{ color:K.err, fontSize:11.5, marginTop:6 }}>⚠ {err}</div>
          )}
          <button onClick={test} disabled={testing || !val.trim()}
            style={{ marginTop:14, width:"100%", background: testing || !val.trim() ? K.brd : "#3B7EF5",
                     color: testing || !val.trim() ? K.mut : "#fff", border:"none", borderRadius:8,
                     padding:"12px", fontSize:14, fontWeight:700, cursor: testing || !val.trim() ? "not-allowed" : "pointer" }}>
            {testing ? "Verifying..." : "Enter Course →"}
          </button>
          <div style={{ marginTop:20, padding:14, background:K.fnt,
                        borderRadius:8, border:`1px solid ${K.brd}` }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#3B7EF5", marginBottom:6 }}>
              How to get a free API key
            </div>
            <ol style={{ paddingLeft:16, margin:0, color:K.mut, fontSize:11.5, lineHeight:1.8 }}>
              <li>Go to <span style={{ color:"#7EB8F7" }}>console.anthropic.com</span></li>
              <li>Sign up or log in</li>
              <li>Click "API Keys" → "Create Key"</li>
              <li>Copy the key (starts with <code style={{ color:"#7EB8F7" }}>sk-ant-</code>)</li>
            </ol>
            <div style={{ marginTop:10, fontSize:11, color:K.mut }}>
              Free tier: $5 credit on signup — enough for hundreds of practice sessions.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI Practice ───────────────────────────────────────────────────────────────
function Practice({ domain, apiKey }) {
  const [st, setSt] = useState({ phase:"idle", q:null, sel:null, shown:false, err:false });

  const gen = async () => {
    setSt({ phase:"loading", q:null, sel:null, shown:false, err:false });
    try {
      const q = await callAPI(apiKey,
        "You write CCA-F (Claude Certified Architect Foundations) exam questions. Scenario-based, 300-level difficulty. Wrong answers must be plausible architectural mistakes engineers actually make. Return ONLY valid JSON — no markdown, no code fences.",
        `Write ONE scenario question for domain: "${domain.title}" (${domain.weight}% of exam).
Wrong answers should be tempting anti-patterns.
Return exactly: {"scenario":"2-3 sentence production context","question":"What is the best architectural decision?","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"2-3 sentences: why correct is right AND why each wrong option fails"}`
      );
      setSt({ phase:"question", q, sel:null, shown:false, err:false });
    } catch { setSt({ phase:"idle", q:null, sel:null, shown:false, err:true }); }
  };

  const ac = domain.accent;
  const optSt = k => {
    const base = { padding:"11px 14px", borderRadius:8, cursor:st.shown?"default":"pointer",
      marginBottom:6, fontSize:12.5, lineHeight:1.55, border:"1px solid", transition:"all .12s" };
    if (!st.shown) return { ...base, borderColor:st.sel===k?ac:K.brd,
      background:st.sel===k?ac+"18":K.crd, color:K.txt };
    if (k === st.q.correct) return { ...base, borderColor:"#10B981", background:"#10B98118", color:"#6EE7B7" };
    if (k === st.sel && k !== st.q.correct) return { ...base, borderColor:"#F43F5E", background:"#F43F5E18", color:"#FCA5A5" };
    return { ...base, borderColor:K.brd, background:K.crd, color:K.mut };
  };

  return (
    <div>
      <p style={{ color:K.mut, fontSize:12.5, lineHeight:1.65, marginBottom:18 }}>
        AI-generated scenario questions from the live Anthropic API — same format as the real exam. Generate unlimited questions per domain.
      </p>
      {st.phase==="idle" && !st.err && (
        <Btn onClick={gen} style={{ background:ac, color:"#000", fontWeight:700,
          borderRadius:8, padding:"11px 26px", fontSize:13 }}>
          ⚡ Generate Scenario Question
        </Btn>
      )}
      {st.phase==="idle" && st.err && (
        <div style={{ color:"#FCA5A5", fontSize:12, padding:14, background:"#F43F5E18",
                      borderRadius:8, border:"1px solid #F43F5E" }}>
          Failed to generate. Check your API key.
          <Btn onClick={gen} style={{ marginLeft:10, fontSize:11, color:"#FCA5A5",
            border:"1px solid #F43F5E", borderRadius:4, padding:"3px 10px" }}>Retry</Btn>
        </div>
      )}
      {st.phase==="loading" && (
        <div style={{ color:K.mut, fontSize:13, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⟳</span>
          Generating scenario...
        </div>
      )}
      {st.phase==="question" && st.q && (
        <div>
          <div style={{ background:K.crd, border:`1px solid ${ac}44`, borderRadius:10, padding:16, marginBottom:14 }}>
            <div style={{ fontSize:9, color:ac, fontWeight:700, letterSpacing:.8, marginBottom:6 }}>PRODUCTION SCENARIO</div>
            <p style={{ color:K.txt, fontSize:13, lineHeight:1.7, margin:0 }}>{st.q.scenario}</p>
          </div>
          <p style={{ color:K.txt, fontWeight:600, fontSize:14, marginBottom:12 }}>{st.q.question}</p>
          {Object.entries(st.q.options).map(([k, v]) => (
            <div key={k} onClick={() => { if (!st.shown) setSt(s=>({...s, sel:k})); }} style={optSt(k)}>
              <span style={{ fontWeight:700, marginRight:8, color:ac }}>{k}.</span>{v}
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}>
            {st.sel && !st.shown && (
              <Btn onClick={() => setSt(s=>({...s, shown:true}))}
                style={{ background:ac, color:"#000", fontWeight:700, borderRadius:8, padding:"9px 22px", fontSize:12 }}>
                Check Answer
              </Btn>
            )}
            <Btn onClick={gen} style={{ border:`1px solid ${K.brdL}`, color:K.mut, borderRadius:8, padding:"9px 18px", fontSize:12 }}>
              ↻ New Question
            </Btn>
          </div>
          {st.shown && (
            <div style={{ marginTop:14,
              background:st.sel===st.q.correct?"#10B98112":"#F43F5E12",
              border:`1px solid ${st.sel===st.q.correct?"#10B981":"#F43F5E"}`,
              borderRadius:10, padding:14 }}>
              <div style={{ fontWeight:700, marginBottom:6, fontSize:13,
                color:st.sel===st.q.correct?"#6EE7B7":"#FCA5A5" }}>
                {st.sel===st.q.correct ? "✓ Correct!" : `✗ Incorrect — correct answer was ${st.q.correct}`}
              </div>
              <p style={{ color:K.txt, fontSize:12.5, lineHeight:1.7, margin:0 }}>{st.q.explanation}</p>
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── Mock Exam ─────────────────────────────────────────────────────────────────
function MockExam({ apiKey }) {
  const [phase, setPhase] = useState("intro");
  const [qs, setQs] = useState([]);
  const [ans, setAns] = useState({});
  const [timeLeft, setTimeLeft] = useState(30*60);
  const [showExp, setShowExp] = useState(false);
  const timer = useRef(null);

  const start = async () => {
    setPhase("loading");
    try {
      const plan = [
        {d:DOMAINS[0],n:4},{d:DOMAINS[1],n:3},{d:DOMAINS[2],n:3},
        {d:DOMAINS[3],n:3},{d:DOMAINS[4],n:2},
      ];
      const all = [];
      for (const { d, n } of plan) {
        for (let i = 0; i < n; i++) {
          const q = await callAPI(apiKey,
            "You write CCA-F exam questions. Hard scenario-based, 300-level. Wrong answers are tempting anti-patterns. Return ONLY valid JSON.",
            `One CCA-F scenario question for domain: "${d.title}". Make wrong answers tempting architectural mistakes.
Return: {"scenario":"...","question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"B","explanation":"..."}`
          );
          all.push({ ...q, domain:d.title, accent:d.accent, qn:all.length+1 });
        }
      }
      setQs(all); setAns({}); setTimeLeft(30*60); setPhase("exam");
      timer.current = setInterval(() => setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer.current); setPhase("results"); return 0; }
        return t-1;
      }), 1000);
    } catch { setPhase("intro"); }
  };

  const submit = () => { clearInterval(timer.current); setPhase("results"); };
  const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const score = qs.filter(q => ans[q.qn] === q.correct).length;
  const scaled = qs.length ? Math.round(score/qs.length*1000) : 0;
  const urgent = timeLeft < 300;

  if (phase === "intro") return (
    <div style={{ padding:"28px 20px", maxWidth:700, margin:"0 auto" }}>
      <div style={{ fontSize:10, color:K.wrn, fontWeight:700, letterSpacing:.8, marginBottom:8 }}>TIMED MOCK EXAM</div>
      <h1 style={{ margin:"0 0 10px", fontSize:22, color:K.txt, fontWeight:700 }}>15-Question Proctored Practice</h1>
      <p style={{ color:K.mut, fontSize:13, lineHeight:1.7, maxWidth:500, marginBottom:24 }}>
        AI-generated questions across all 5 domains, weighted to match the real exam. 30 minutes. Same scenario format as CCA-F day.
      </p>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24 }}>
        {[["15","Questions"],["30 min","Time Limit"],["All 5","Domains"],["720","Pass Threshold"]].map(([v,l]) => (
          <div key={l} style={{ background:K.crd, border:`1px solid ${K.brd}`, borderRadius:10,
                                padding:"10px 18px", minWidth:90, flex:"1 1 90px", textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:K.txt }}>{v}</div>
            <div style={{ fontSize:10, color:K.mut, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>
      <Btn onClick={start} style={{ background:K.wrn, color:"#000", fontWeight:700,
        borderRadius:8, padding:"12px 32px", fontSize:14 }}>
        Start Exam →
      </Btn>
    </div>
  );

  if (phase === "loading") return (
    <div style={{ padding:"60px 20px", textAlign:"center" }}>
      <div style={{ fontSize:40, animation:"spin 1s linear infinite", display:"inline-block", marginBottom:16 }}>⟳</div>
      <div style={{ color:K.txt, fontSize:16, fontWeight:600 }}>Generating 15 exam questions...</div>
      <div style={{ color:K.mut, fontSize:12, marginTop:6 }}>~30 seconds — AI-generating across all 5 domains</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (phase === "exam") return (
    <div style={{ padding:"0 20px 40px", maxWidth:780, margin:"0 auto" }}>
      <div style={{ position:"sticky", top:0, background:K.bg, padding:"12px 0 14px",
                    borderBottom:`1px solid ${K.brd}`, display:"flex",
                    justifyContent:"space-between", alignItems:"center",
                    flexWrap:"wrap", gap:8, marginBottom:20, zIndex:10 }}>
        <div>
          <span style={{ fontWeight:700, color:K.txt, fontSize:14 }}>Mock Exam</span>
          <span style={{ color:K.mut, fontSize:12, marginLeft:10 }}>
            {Object.keys(ans).length}/{qs.length} answered
          </span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <div style={{ fontSize:16, fontWeight:800, fontFamily:"monospace",
                        color:urgent?"#F43F5E":K.wrn, padding:"4px 14px", borderRadius:8,
                        background:urgent?"#F43F5E18":"#F59E0B18",
                        border:`1px solid ${urgent?"#F43F5E":K.wrn}` }}>
            ⏱ {fmt(timeLeft)}
          </div>
          <Btn onClick={submit} style={{ background:K.wrn, color:"#000", fontWeight:700,
            borderRadius:8, padding:"7px 18px", fontSize:12 }}>Submit</Btn>
        </div>
      </div>
      {qs.map((q, i) => (
        <div key={i} style={{ background:K.crd, border:`1px solid ${ans[q.qn]?q.accent+"44":K.brd}`,
                              borderRadius:12, padding:18, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:q.accent+"22",
                          color:q.accent, fontSize:11, fontWeight:700, display:"flex",
                          alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {i+1}
            </div>
            <span style={{ fontSize:10, color:q.accent, fontWeight:700, letterSpacing:.4 }}>{q.domain}</span>
          </div>
          <div style={{ background:K.fnt, borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
            <span style={{ fontSize:10, color:K.mut, fontWeight:700 }}>SCENARIO  </span>
            <span style={{ color:K.txt, fontSize:12.5, lineHeight:1.65 }}>{q.scenario}</span>
          </div>
          <p style={{ color:K.txt, fontWeight:600, fontSize:13, marginBottom:10 }}>{q.question}</p>
          {Object.entries(q.options).map(([k, v]) => (
            <div key={k} onClick={() => setAns(a => ({...a, [q.qn]:k}))}
              style={{ padding:"9px 12px", border:`1px solid ${ans[q.qn]===k?q.accent:K.brd}`,
                       borderRadius:7, cursor:"pointer", marginBottom:5, fontSize:12.5,
                       background:ans[q.qn]===k?q.accent+"18":K.crd,
                       color:K.txt, transition:"all .12s" }}>
              <span style={{ fontWeight:700, marginRight:8, color:q.accent }}>{k}.</span>{v}
            </div>
          ))}
        </div>
      ))}
      <div style={{ textAlign:"center", paddingTop:16 }}>
        <Btn onClick={submit} style={{ background:K.wrn, color:"#000", fontWeight:700,
          borderRadius:8, padding:"12px 32px", fontSize:13 }}>Submit Exam</Btn>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ padding:"28px 20px", maxWidth:780, margin:"0 auto" }}>
      <div style={{ textAlign:"center", background:K.crd,
                    border:`1px solid ${scaled>=720?"#10B981":"#F43F5E"}44`,
                    borderRadius:14, padding:28, marginBottom:24 }}>
        <div style={{ fontSize:10, color:K.mut, letterSpacing:.5, marginBottom:8 }}>
          {scaled>=720?"✓ PASSED":"✗ NEEDS MORE WORK"}
        </div>
        <div style={{ fontSize:60, fontWeight:900, lineHeight:1,
                      color:scaled>=720?"#10B981":"#F43F5E" }}>{scaled}</div>
        <div style={{ fontSize:13, color:K.mut, marginTop:4 }}>
          out of 1000 · {score}/{qs.length} correct · Pass: 720+
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <span style={{ fontSize:11, color:K.mut, fontWeight:700, letterSpacing:.4 }}>FULL REVIEW</span>
        <Btn onClick={() => setShowExp(!showExp)}
          style={{ fontSize:11, color:K.mut, border:`1px solid ${K.brdL}`, borderRadius:6, padding:"4px 14px" }}>
          {showExp ? "Hide" : "Show"} Explanations
        </Btn>
      </div>
      {qs.map((q, i) => {
        const ok = ans[q.qn] === q.correct;
        return (
          <div key={i} style={{ background:K.crd,
                                border:`1px solid ${ok?"#10B98144":"#F43F5E44"}`,
                                borderRadius:10, padding:16, marginBottom:8 }}>
            <div style={{ display:"flex", gap:10, marginBottom:8 }}>
              <span style={{ color:ok?"#10B981":"#F43F5E", fontWeight:700, fontSize:16 }}>{ok?"✓":"✗"}</span>
              <div>
                <div style={{ fontSize:10, color:q.accent, fontWeight:700, letterSpacing:.4, marginBottom:2 }}>{q.domain}</div>
                <div style={{ fontSize:13, color:K.txt, lineHeight:1.5 }}>{q.question}</div>
                <div style={{ fontSize:11, color:K.mut, marginTop:4 }}>
                  You: <span style={{ color:ok?"#6EE7B7":"#FCA5A5", fontWeight:700 }}>{ans[q.qn]||"—"}</span>
                  {!ok && <span> · Correct: <span style={{ color:"#6EE7B7", fontWeight:700 }}>{q.correct}</span></span>}
                </div>
              </div>
            </div>
            {showExp && (
              <div style={{ background:K.fnt, borderRadius:7, padding:"10px 12px",
                            fontSize:12, color:K.mut, lineHeight:1.65 }}>💡 {q.explanation}</div>
            )}
          </div>
        );
      })}
      <div style={{ display:"flex", gap:10, marginTop:20, flexWrap:"wrap" }}>
        <Btn onClick={start} style={{ background:K.wrn, color:"#000", fontWeight:700,
          borderRadius:8, padding:"11px 24px", fontSize:13 }}>↻ Retake Exam</Btn>
        <Btn onClick={() => setPhase("intro")}
          style={{ border:`1px solid ${K.brdL}`, color:K.mut, borderRadius:8, padding:"11px 20px", fontSize:13 }}>
          Back to Intro
        </Btn>
      </div>
    </div>
  );
}

// ── Domain Page ───────────────────────────────────────────────────────────────
function DomainPage({ domain, completed, toggle, apiKey }) {
  const [tab, setTab] = useState("learn");
  const [open, setOpen] = useState(null);
  const done = domain.lessons.filter(l => completed.has(l.id)).length;
  const pct = Math.round(done/domain.lessons.length*100);
  const ac = domain.accent;
  const tabSt = t => ({
    padding:"7px 18px", border:"none", cursor:"pointer", fontSize:12.5, fontWeight:600,
    borderRadius:6, background:tab===t?ac:"none", color:tab===t?"#000":K.mut,
  });

  return (
    <div style={{ padding:"24px 20px", maxWidth:860, margin:"0 auto" }}>
      <div style={{ marginBottom:22 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <span style={{ fontSize:26 }}>{domain.icon}</span>
          <div>
            <div style={{ fontSize:9, color:ac, fontWeight:700, letterSpacing:.8 }}>
              DOMAIN {domain.num} · {domain.weight}% OF EXAM
            </div>
            <h1 style={{ margin:0, fontSize:20, color:K.txt, fontWeight:700 }}>{domain.title}</h1>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6, maxWidth:280 }}>
          <span style={{ fontSize:11, color:K.mut, flexShrink:0 }}>{pct}% done</span>
          <div style={{ flex:1 }}><Bar pct={pct} color={ac}/></div>
        </div>
      </div>

      <div style={{ display:"flex", gap:3, marginBottom:20, background:K.crd,
                    borderRadius:8, padding:4, width:"fit-content", border:`1px solid ${K.brd}` }}>
        {[["learn","📖 Learn"],["lab","⚗️ Lab"],["practice","🎯 Practice"]].map(([t,l]) => (
          <Btn key={t} onClick={() => setTab(t)} style={tabSt(t)}>{l}</Btn>
        ))}
      </div>

      {tab === "learn" && (
        <div>
          {domain.lessons.map((ls, i) => {
            const isDone = completed.has(ls.id);
            const isOpen = open === ls.id;
            return (
              <div key={ls.id} style={{ border:`1px solid ${isOpen?ac+"55":K.brd}`,
                borderRadius:10, marginBottom:8, overflow:"hidden",
                background:isOpen?K.crd:K.bg, transition:"border .2s" }}>
                <div onClick={() => setOpen(isOpen?null:ls.id)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 16px", cursor:"pointer" }}>
                  <div onClick={e => { e.stopPropagation(); toggle(ls.id); }}
                    style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                             border:`2px solid ${isDone?"#10B981":K.brdL}`,
                             background:isDone?"#10B981":"none", cursor:"pointer",
                             display:"flex", alignItems:"center", justifyContent:"center",
                             transition:"all .2s" }}>
                    {isDone && <span style={{ color:"#000", fontSize:11, fontWeight:700 }}>✓</span>}
                  </div>
                  <div style={{ flex:1 }}>
                    <span style={{ fontSize:10, color:K.mut }}>{String(i+1).padStart(2,"0")}</span>
                    <span style={{ fontSize:13.5, fontWeight:600, color:K.txt, marginLeft:8 }}>{ls.title}</span>
                  </div>
                  <span style={{ color:K.mut, fontSize:12,
                    transform:`rotate(${isOpen?90:0}deg)`, transition:"transform .2s" }}>›</span>
                </div>
                {isOpen && (
                  <div style={{ padding:"0 16px 16px", borderTop:`1px solid ${K.brd}` }}>
                    <ul style={{ paddingLeft:18, margin:"14px 0 0", lineHeight:1.85 }}>
                      {ls.pts.map((p, j) => (
                        <li key={j} style={{ color:K.txt, fontSize:13, marginBottom:3 }}>{p}</li>
                      ))}
                    </ul>
                    {ls.code && <Code src={ls.code}/>}
                    <Btn onClick={() => toggle(ls.id)}
                      style={{ marginTop:12, border:`1px solid ${isDone?"#10B981":K.brdL}`,
                               color:isDone?"#10B981":K.mut, borderRadius:6,
                               padding:"5px 14px", fontSize:11,
                               background:isDone?"#10B98118":"none" }}>
                      {isDone ? "✓ Marked complete" : "Mark complete"}
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "lab" && (
        <div>
          <div style={{ background:K.crd, border:`1px solid ${ac}44`,
                        borderRadius:12, padding:20, marginBottom:18 }}>
            <div style={{ fontSize:9, color:ac, fontWeight:700, letterSpacing:.8, marginBottom:6 }}>HANDS-ON LAB</div>
            <h2 style={{ margin:"0 0 8px", fontSize:17, color:K.txt }}>{domain.lab.title}</h2>
            <p style={{ color:K.mut, fontSize:13, lineHeight:1.65, margin:0 }}>{domain.lab.desc}</p>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10, color:K.mut, fontWeight:700, marginBottom:8, letterSpacing:.4 }}>LAB STEPS</div>
            {domain.lab.steps.map((s, i) => (
              <div key={i} style={{ display:"flex", gap:10, padding:"9px 12px",
                                    background:K.crd, border:`1px solid ${K.brd}`,
                                    borderRadius:8, marginBottom:5 }}>
                <span style={{ width:20, height:20, borderRadius:"50%",
                               background:ac+"22", color:ac, fontSize:10, fontWeight:700,
                               display:"flex", alignItems:"center", justifyContent:"center",
                               flexShrink:0 }}>{i+1}</span>
                <span style={{ color:K.txt, fontSize:12.5, lineHeight:1.5 }}>{s}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize:10, color:K.mut, fontWeight:700, marginBottom:6, letterSpacing:.4 }}>STARTER CODE</div>
          <Code src={domain.lab.code}/>
        </div>
      )}

      {tab === "practice" && <Practice domain={domain} apiKey={apiKey}/>}
    </div>
  );
}

// ── Anti-Patterns ─────────────────────────────────────────────────────────────
function AntiPatterns() {
  return (
    <div style={{ padding:"24px 20px", maxWidth:860, margin:"0 auto" }}>
      <div style={{ fontSize:9, color:"#F43F5E", fontWeight:700, letterSpacing:.8, marginBottom:6 }}>
        EXAM CRITICAL — ALL 7 MUST BE MEMORIZED
      </div>
      <h1 style={{ margin:"0 0 8px", fontSize:22, color:K.txt, fontWeight:700 }}>The 7 Anti-Patterns</h1>
      <p style={{ color:K.mut, fontSize:13, lineHeight:1.65, marginBottom:22 }}>
        Wrong answers on the CCA-F are these exact mistakes — memorize them and you eliminate trap options automatically.
      </p>
      {ANTI_PATTERNS.map((ap, i) => (
        <div key={ap.id} style={{ background:K.crd, border:`1px solid ${K.brd}`,
                                   borderRadius:12, padding:18, marginBottom:10 }}>
          <div style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ width:26, height:26, borderRadius:"50%", background:"#F43F5E22",
                          color:"#F43F5E", fontWeight:700, fontSize:11, display:"flex",
                          alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {i+1}
            </div>
            <h3 style={{ margin:0, fontSize:14, color:K.txt, fontWeight:700 }}>{ap.title}</h3>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
            <div style={{ background:"#F43F5E10", border:"1px solid #F43F5E40", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#F43F5E", fontWeight:700, letterSpacing:.5, marginBottom:5 }}>✗ WRONG</div>
              <p style={{ color:"#FCA5A5", fontSize:12, lineHeight:1.65, margin:0 }}>{ap.wrong}</p>
            </div>
            <div style={{ background:"#10B98110", border:"1px solid #10B98140", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"#10B981", fontWeight:700, letterSpacing:.5, marginBottom:5 }}>✓ CORRECT</div>
              <p style={{ color:"#6EE7B7", fontSize:12, lineHeight:1.65, margin:0 }}>{ap.right}</p>
            </div>
          </div>
          <div style={{ background:K.fnt, borderRadius:6, padding:"9px 12px",
                        fontSize:12, color:K.mut, lineHeight:1.65 }}>
            💡 <span style={{ color:K.txt, fontWeight:500 }}>Why: </span>{ap.why}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Quick Reference ───────────────────────────────────────────────────────────
function QuickRef() {
  return (
    <div style={{ padding:"24px 20px", maxWidth:860, margin:"0 auto" }}>
      <div style={{ fontSize:9, color:"#06B6D4", fontWeight:700, letterSpacing:.8, marginBottom:6 }}>CHEAT SHEET</div>
      <h1 style={{ margin:"0 0 6px", fontSize:22, color:K.txt, fontWeight:700 }}>Quick Reference</h1>
      <p style={{ color:K.mut, fontSize:13, marginBottom:22, lineHeight:1.6 }}>
        Exact values and rules tested directly on the exam. Memorize this the night before.
      </p>
      {QREF.map(s => (
        <div key={s.cat} style={{ background:K.crd, border:`1px solid ${K.brd}`,
                                   borderRadius:12, padding:18, marginBottom:10 }}>
          <div style={{ fontSize:13, fontWeight:700, color:K.txt, marginBottom:12 }}>{s.cat}</div>
          {s.rows.map(([k, v]) => (
            <div key={k} style={{ display:"flex", gap:12, padding:"8px 0",
                                   borderBottom:`1px solid ${K.brd}` }}>
              <div style={{ fontFamily:"monospace", fontSize:11.5, color:"#7EB8F7",
                            minWidth:180, flexShrink:0, lineHeight:1.5 }}>{k}</div>
              <div style={{ fontSize:12.5, color:K.txt, lineHeight:1.6 }}>{v}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Course Home ───────────────────────────────────────────────────────────────
function Home({ setPage, dp, total, doneCount }) {
  const pct = Math.round(doneCount/total*100);
  return (
    <div style={{ padding:"24px 20px", maxWidth:860, margin:"0 auto" }}>
      <div style={{ fontSize:9, color:"#3B7EF5", fontWeight:700, letterSpacing:.8, marginBottom:8 }}>ANTHROPIC · CCA-F</div>
      <h1 style={{ margin:"0 0 6px", fontSize:26, color:K.txt, fontWeight:800, lineHeight:1.15 }}>
        Claude Certified Architect<br/>
        <span style={{ color:"#3B7EF5" }}>Foundations — Lab Course</span>
      </h1>
      <p style={{ color:K.mut, fontSize:13, lineHeight:1.7, maxWidth:520, margin:"10px 0 0" }}>
        Full exam coverage — 25 lessons, 5 hands-on labs, AI-powered practice per domain, 7 anti-pattern cards, scored mock exam, and quick-reference cheat sheet.
      </p>
      <div style={{ background:K.crd, border:"1px solid #3B7EF544", borderRadius:12,
                    padding:16, margin:"24px 0 20px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:12, color:K.txt, fontWeight:600 }}>Overall Progress</span>
          <span style={{ fontSize:12, color:"#3B7EF5", fontWeight:700 }}>{pct}%</span>
        </div>
        <Bar pct={pct} color="#3B7EF5"/>
        <div style={{ fontSize:11, color:K.mut, marginTop:5 }}>{doneCount} of {total} lessons marked complete</div>
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
        {[["60","Questions"],["120 min","Time Limit"],["720/1000","Pass Score"],["5","Domains"]].map(([v,l]) => (
          <div key={l} style={{ background:K.crd, border:`1px solid ${K.brd}`, borderRadius:10,
                                padding:"10px 16px", minWidth:88, flex:"1 1 88px", textAlign:"center" }}>
            <div style={{ fontSize:17, fontWeight:800, color:K.txt }}>{v}</div>
            <div style={{ fontSize:10, color:K.mut, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize:10, color:K.mut, fontWeight:700, letterSpacing:.4, marginBottom:10 }}>EXAM DOMAINS</div>
      {DOMAINS.map(d => (
        <div key={d.id} onClick={() => setPage(d.id)}
          style={{ display:"flex", alignItems:"center", gap:12, background:K.crd,
                   border:`1px solid ${K.brd}`, borderRadius:10, padding:"12px 16px",
                   marginBottom:6, cursor:"pointer", transition:"border .15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=d.accent+"88"}
          onMouseLeave={e => e.currentTarget.style.borderColor=K.brd}>
          <span style={{ fontSize:18 }}>{d.icon}</span>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
              <span style={{ fontSize:13, fontWeight:600, color:K.txt }}>{d.title}</span>
              <span style={{ fontSize:10, background:d.accent+"22", color:d.accent,
                             padding:"1px 7px", borderRadius:10, fontWeight:700 }}>{d.weight}%</span>
            </div>
            <Bar pct={dp(d.id)} color={d.accent}/>
          </div>
          <span style={{ color:K.mut }}>›</span>
        </div>
      ))}
      <div style={{ background:"#3B7EF512", border:"1px solid #3B7EF544",
                    borderRadius:12, padding:14, marginTop:16 }}>
        <p style={{ margin:0, color:"#93C5FD", fontSize:12.5, lineHeight:1.7 }}>
          💡 <strong>Infosys Partner Advantage:</strong> Your @infosys.com email qualifies for the Anthropic Partner Network — free access and $99 exam fee waiver. Register at <strong>anthropic.skilljar.com</strong>.
        </p>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, dp, col, setCol }) {
  const nav = (id, label, icon, ac) => {
    const act = page === id;
    return (
      <Btn key={id} onClick={() => { setPage(id); if (window.innerWidth < 700) setCol(true); }}
        style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 10px",
                 borderRadius:8, marginBottom:1, width:"100%", textAlign:"left",
                 background:act?(ac||"#3B7EF5")+"20":"none",
                 color:act?(ac||"#3B7EF5"):K.mut,
                 borderLeft:act?`2px solid ${ac||"#3B7EF5"}`:"2px solid transparent" }}>
        <span style={{ fontSize:14, flexShrink:0 }}>{icon}</span>
        {!col && <span style={{ fontSize:12, fontWeight:act?700:400,
                                whiteSpace:"nowrap", overflow:"hidden",
                                textOverflow:"ellipsis" }}>{label}</span>}
      </Btn>
    );
  };
  return (
    <div style={{ width:col?44:218, background:K.sdb, borderRight:`1px solid ${K.brd}`,
                  display:"flex", flexDirection:"column", flexShrink:0,
                  transition:"width .2s", overflow:"hidden", minHeight:"100vh" }}>
      <div style={{ padding:"12px 10px", borderBottom:`1px solid ${K.brd}`,
                    display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        {!col && <div>
          <div style={{ fontSize:13, fontWeight:800, color:"#3B7EF5", letterSpacing:.3 }}>CCA-F</div>
          <div style={{ fontSize:9, color:K.mut }}>Lab Course</div>
        </div>}
        <Btn onClick={() => setCol(!col)}
          style={{ border:`1px solid ${K.brd}`, color:K.mut, borderRadius:6,
                   width:26, height:26, display:"flex", alignItems:"center",
                   justifyContent:"center", flexShrink:0, marginLeft:col?0:"auto", fontSize:12 }}>
          {col?"›":"‹"}
        </Btn>
      </div>
      <div style={{ flex:1, padding:"8px 6px", overflowY:"auto" }}>
        {!col && <div style={{ fontSize:9, color:K.mut, padding:"6px 4px 3px", letterSpacing:.5 }}>OVERVIEW</div>}
        {nav("home",  "Course Home",     "🏠")}
        {nav("anti",  "Anti-Patterns",   "⚠️", "#F43F5E")}
        {nav("qref",  "Quick Reference", "📋", "#06B6D4")}
        {nav("exam",  "Mock Exam",       "📝", "#F59E0B")}
        {!col && <div style={{ fontSize:9, color:K.mut, padding:"10px 4px 3px", letterSpacing:.5 }}>DOMAINS</div>}
        {DOMAINS.map(d => (
          <div key={d.id}>
            {nav(d.id, `D${d.num}: ${d.title.slice(0,22)}…`, d.icon, d.accent)}
            {!col && <div style={{ padding:"0 10px 3px 36px" }}><Bar pct={dp(d.id)} color={d.accent}/></div>}
          </div>
        ))}
      </div>
      {!col && <div style={{ padding:"10px 12px", borderTop:`1px solid ${K.brd}`,
                             fontSize:10, color:K.mut }}>Pass: 720 / 1000</div>}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Check for API key in env (for Claude.ai artifact runner or Vite env vars)
  const envKey = typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_ANTHROPIC_API_KEY || ""
    : "";

  const [apiKey, setApiKey] = useState(envKey);
  const [page, setPage] = useState("home");
  const [done, setDone] = useState(new Set());
  const [col, setCol] = useState(typeof window !== "undefined" && window.innerWidth < 600);

  const toggle = id => setDone(p => { const n = new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  const dp = id => {
    const d = DOMAINS.find(x => x.id === id);
    if (!d) return 0;
    return Math.round(d.lessons.filter(l => done.has(l.id)).length / d.lessons.length * 100);
  };
  const total = DOMAINS.reduce((a, d) => a + d.lessons.length, 0);
  const ad = DOMAINS.find(d => d.id === page);

  // Show API key screen when deployed outside Claude.ai
  if (!apiKey) return <ApiKeyScreen onKey={setApiKey}/>;

  return (
    <div style={{ display:"flex", minHeight:"100vh", background:K.bg, color:K.txt,
                  fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <Sidebar page={page} setPage={setPage} dp={dp} col={col} setCol={setCol}/>
      <main style={{ flex:1, overflowY:"auto", minWidth:0 }}>
        {page==="home" && <Home setPage={setPage} dp={dp} total={total} doneCount={done.size}/>}
        {page==="anti" && <AntiPatterns/>}
        {page==="qref" && <QuickRef/>}
        {page==="exam" && <MockExam apiKey={apiKey}/>}
        {ad && <DomainPage domain={ad} completed={done} toggle={toggle} apiKey={apiKey}/>}
      </main>
    </div>
  );
}
