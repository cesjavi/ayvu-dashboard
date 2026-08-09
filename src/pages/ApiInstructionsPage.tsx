import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Code2, Key, Globe, AlertCircle, ChevronRight, Copy, Check, FileJson, BookOpen } from "lucide-react";
import { copyToClipboard } from "../lib/utils";
import { supabase } from "../lib/supabase";

const SUPABASE_URL = "https://qeihnzhmyiinbwqhdqji.supabase.co";

const codeStyle =
  "bg-elevated border border-border rounded-md p-4 font-mono text-sm text-foreground overflow-x-auto";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 p-1.5 rounded-md text-muted hover:text-foreground hover:bg-surface transition-all duration-150 cursor-pointer"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  );
}

function CodeBlock({ code, language: _language = "bash" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className={codeStyle}>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <section className="space-y-4 scroll-mt-6" id={id}>
      <div className="flex items-center gap-2.5 border-b border-border pb-3">
        <div className="w-7 h-7 rounded-md bg-accent/15 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-accent" />
        </div>
        <h2 className="text-lg font-heading font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StepBox({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center">
          <span className="text-xs font-bold text-accent">{step}</span>
        </div>
        <div className="w-px flex-1 bg-border mt-2" />
      </div>
      <div className="pb-6 flex-1 space-y-2 min-w-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <div className="text-sm text-muted leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  );
}

function InfoBox({ type = "info", children }: { type?: "info" | "warning"; children: React.ReactNode }) {
  const colors =
    type === "warning"
      ? "bg-warning/10 border-warning/30 text-warning"
      : "bg-accent/10 border-accent/30 text-accent";
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-md border ${colors} text-sm`}>
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

// ─── Try-It section: preview agent instructions ─────────────────────────

function AgentInstructionsPreview({ workspaceId }: { workspaceId: string }) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [instructions, setInstructions] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name")
      .then(({ data }) => setProjects(data ?? []));
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setAgents([]);
      return;
    }
    supabase
      .from("agents")
      .select("id, name")
      .eq("project_id", selectedProjectId)
      .order("name")
      .then(({ data }) => setAgents(data ?? []));
  }, [selectedProjectId]);

  const loadInstructions = async () => {
    if (!selectedAgentId) return;
    setLoading(true);
    setError(null);
    setInstructions(null);

    try {
      const { data: apiKeys } = await supabase
        .from("workspace_api_keys")
        .select("id, key_hash, prefix")
        .eq("is_revoked", false)
        .limit(1);

      if (!apiKeys || apiKeys.length === 0) {
        setError("No active API key found. Generate one in Settings > API Keys first.");
        return;
      }

      // We can't call the external API from the browser with a hashed key,
      // so we'll fetch the agent data directly from the DB instead
      const { data: agent } = await supabase
        .from("agents")
        .select("*, projects!inner(id, name)")
        .eq("id", selectedAgentId)
        .single();

      if (!agent) {
        setError("Agent not found");
        return;
      }

      const project = Array.isArray(agent.projects) ? agent.projects[0] : agent.projects;
      const inputSchema = agent.input_schema as Record<string, unknown> | null;
      const outputSchema = agent.output_schema as Record<string, unknown> | null;

      // Build sample params
      const sampleParams: Record<string, unknown> = {};
      if (inputSchema?.properties && typeof inputSchema.properties === "object") {
        const props = inputSchema.properties as Record<string, unknown>;
        for (const [key, prop] of Object.entries(props)) {
          const p = prop as Record<string, unknown>;
          const val = (p.enum && Array.isArray(p.enum))
            ? (p.enum as unknown[])[0]
            : p.type === "number" || p.type === "integer"
              ? 42
              : p.type === "boolean"
                ? true
                : `sample_${key}`;
          sampleParams[key] = val;
        }
      }

      const sampleResponse: Record<string, unknown> = {};
      if (outputSchema?.properties && typeof outputSchema.properties === "object") {
        const props = outputSchema.properties as Record<string, unknown>;
        for (const [key, prop] of Object.entries(props)) {
          const p = prop as Record<string, unknown>;
          const val = (p.enum && Array.isArray(p.enum))
            ? (p.enum as unknown[])[0]
            : p.type === "number" || p.type === "integer"
              ? 42
              : p.type === "boolean"
                ? true
                : `sample_${key}_result`;
          sampleResponse[key] = val;
        }
      }

      const projectId = project?.id ?? "";

      const curlCreate = `curl -X POST \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
  "projectId": "${projectId}",
  "parameters": ${JSON.stringify(sampleParams, null, 2)}
}' \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs"`;

      const curlPoll = `curl -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs/<runId>?workspaceId=<wsId>&projectId=${projectId}"`;

      setInstructions({
        agent: { id: agent.id, name: agent.name, description: agent.description },
        project: { id: projectId, name: project?.name ?? "" },
        input_schema: inputSchema ?? {},
        output_schema: outputSchema ?? null,
        sample_request: { curl: curlCreate, parameters: sampleParams },
        sample_response: { poll_curl: curlPoll, expected_output: outputSchema ? sampleResponse : "(free text)" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instructions");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted leading-relaxed">
        Select a project and agent to preview what the{" "}
        <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">instructions</code> endpoint returns:
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setSelectedAgentId("");
            setInstructions(null);
          }}
          className="bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={selectedAgentId}
          onChange={(e) => {
            setSelectedAgentId(e.target.value);
            setInstructions(null);
          }}
          disabled={!selectedProjectId}
          className="bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
        >
          <option value="">Select an agent...</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <button
          onClick={loadInstructions}
          disabled={!selectedAgentId || loading}
          className="bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? "Loading..." : "Preview instructions"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">{error}</div>
      )}

      {instructions && (
        <div className="bg-surface border border-border rounded-md p-4 space-y-3">
          {instructions.sample_request && (
            <>
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Sample cURL (create run)</h4>
              <CodeBlock code={(instructions.sample_request as Record<string, unknown>).curl as string} />
            </>
          )}
          {instructions.sample_response && (
            <>
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider">Sample poll cURL</h4>
              <CodeBlock code={(instructions.sample_response as Record<string, unknown>).poll_curl as string} />
            </>
          )}
          <div className="text-xs text-muted">
            <span className="font-medium text-foreground">Input schema:</span>{" "}
            {Object.keys((instructions.input_schema as Record<string, unknown>)?.properties ?? {}).length > 0
              ? JSON.stringify(instructions.input_schema, null, 2)
              : "(none defined)"}
          </div>
          <div className="text-xs text-muted">
            <span className="font-medium text-foreground">Output schema:</span>{" "}
            {instructions.output_schema
              ? JSON.stringify(instructions.output_schema, null, 2)
              : "(none — free text)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────

export default function ApiInstructionsPage() {
  const { workspaceId } = useParams();

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted mb-3">
          <Globe size={12} />
          <span>API</span>
          <ChevronRight size={10} />
          <span>v1</span>
        </div>
        <h1 className="text-2xl font-heading font-bold text-foreground">
          External API — Connect via REST
        </h1>
        <p className="text-sm text-muted mt-2 leading-relaxed max-w-2xl">
          Use the Ayvu REST API to trigger agent cascade runs from your own
          applications, poll for results, and discover what parameters each agent expects —
          all authenticated with workspace-scoped API keys.
        </p>
      </div>

      {/* 1. Authentication */}
      <Section icon={Key} title="Authentication">
        <p className="text-sm text-muted leading-relaxed">
          Every request must include a workspace API key in the <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">Authorization</code> header.
          Generate keys from the{" "}
          <Link
            to={`/workspace/${workspaceId}/settings`}
            className="text-accent hover:text-accent-hover underline underline-offset-2 transition-colors duration-150"
          >
            Settings &rarr; API Keys
          </Link>{" "}
          page.
        </p>

        <div className="space-y-3">
          <StepBox step={1} title="Generate a key">
            <p>
              Go to <strong>Settings &rarr; API Keys</strong>, click{" "}
              <strong>Generate New Key</strong>, and give it a name (e.g. "Production", "Staging").
            </p>
          </StepBox>
          <StepBox step={2} title="Copy the key immediately">
            <p>
              The full key is shown <strong>exactly once</strong> in a modal. Copy it and store it
              securely — you won't be able to see it again.
            </p>
          </StepBox>
          <StepBox step={3} title="Send it with every request">
            <p>
              Include the key in the <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">Authorization</code> header as a Bearer token:
            </p>
          </StepBox>
        </div>

        <CodeBlock
          code={`Authorization: Bearer sk_a1b2c3d4_5x7y8z9a0b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2x`}
          language="http"
        />

        <InfoBox type="warning">
          Keep your API key secret. Anyone with the key can trigger runs in your workspace. If a key
          is compromised, revoke it immediately from the Settings page.
        </InfoBox>
      </Section>

      {/* 2. Base URL */}
      <Section icon={Globe} title="Base URL">
        <p className="text-sm text-muted leading-relaxed">
          All API requests are served via Supabase Edge Functions. The base URL for all v1
          endpoints is:
        </p>

        <CodeBlock
          code={`${SUPABASE_URL}/functions/v1/external-v1/api/v1`}
          language="bash"
        />

        <div className="text-sm text-muted leading-relaxed space-y-1.5">
          <p>Two query string parameters are required on every request:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">workspaceId</code> — your workspace UUID
            </li>
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">projectId</code> — the project UUID
            </li>
          </ul>
        </div>
      </Section>

      {/* 3. Endpoints */}
      <Section icon={Code2} title="Endpoints">
        <div className="space-y-6">
          {/* GET /schema */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-success/15 text-success">GET</span>
              <code className="text-sm font-mono text-foreground">/schema</code>
            </div>
            <p className="text-sm text-muted mb-3">
              Discover the input and output schemas for every agent in a project. Use this to
              know what parameters to send when triggering a run.
            </p>
            <CodeBlock
              code={`curl -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/schema?workspaceId=${workspaceId ?? "<workspaceId>"}&projectId=<projectId>"`}
              language="bash"
            />
            <p className="text-xs text-muted mt-2">
              Returns a JSON array of agents with their{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">input_schema</code> and{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">output_schema</code>.
            </p>
          </div>

          {/* POST /runs */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent/15 text-accent">POST</span>
              <code className="text-sm font-mono text-foreground">/runs</code>
            </div>
            <p className="text-sm text-muted mb-3">
              Trigger a new agent cascade run. Pass parameters validated against each agent's{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">input_schema</code>.
            </p>
            <CodeBlock
              code={`curl -X POST -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "${workspaceId ?? "<workspaceId>"}",
    "projectId": "<projectId>",
    "parameters": {
      "customer_id": "12345",
      "usage_amount": 1500.50
    }
  }' \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs"`}
              language="bash"
            />
            <p className="text-xs text-muted mt-2">
              Returns immediately with{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">{`{ "runId": "<uuid>", "status": "queued" }`}</code>.
            </p>
          </div>

          {/* GET /runs/:runId */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-success/15 text-success">GET</span>
              <code className="text-sm font-mono text-foreground">/runs/{"{runId}"}</code>
            </div>
            <p className="text-sm text-muted mb-3">
              Poll for the result of a run. Keep checking until the status changes from{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">running</code> to{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">completed</code>.
            </p>
            <CodeBlock
              code={`curl -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs/<runId>?workspaceId=${workspaceId ?? "<workspaceId>"}&projectId=<projectId>"`}
              language="bash"
            />
            <p className="text-xs text-muted mt-2">
              A completed response includes the full run result with all agent outputs, token usage, and timings.
            </p>
          </div>

          {/* GET /agents/:agentId/instructions (NEW) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-success/15 text-success">GET</span>
              <code className="text-sm font-mono text-foreground">/agents/{"{agentId}"}/instructions</code>
            </div>
            <p className="text-sm text-muted mb-3">
              Get per-agent usage instructions. Returns the agent's{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">input_schema</code> and{" "}
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">output_schema</code>,
              auto-generated sample <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">cURL</code> commands,
              and a natural-language explanation of the full flow. This endpoint is designed to be just as useful to a
              human developer as to an LLM orchestrating calls to this agent.
            </p>
            <CodeBlock
              code={`curl -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/agents/<agentId>/instructions?workspaceId=${workspaceId ?? "<workspaceId>"}&projectId=<projectId>"`}
              language="bash"
            />
            <p className="text-xs text-muted mt-2">
              Returns the agent's schemas, sample request/response, and a flow explanation.
            </p>
          </div>
        </div>
      </Section>

      {/* 4. Schema Contract */}
      <Section icon={FileJson} title="Input / Output Schema Contract">
        <p className="text-sm text-muted leading-relaxed">
          Every agent exposes two optional JSON Schema (Draft-07) objects that define its
          contract with the outside world:
        </p>

        <h3 className="text-sm font-medium text-foreground mt-4">Input Schema</h3>
        <p className="text-sm text-muted leading-relaxed">
          Defines the parameters the agent expects when a run is triggered. Each property has a
          type (<code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">string</code>,{" "}
          <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">number</code>,{" "}
          <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">boolean</code>,{" "}
          <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">integer</code>),
          an optional description, optional enum values, and a required flag.
        </p>
        <CodeBlock
          code={`{
  "type": "object",
  "properties": {
    "customer_id": { "type": "string", "description": "The customer identifier" },
    "tier": { "type": "string", "enum": ["basic", "premium", "enterprise"] }
  },
  "required": ["customer_id"]
}`}
          language="json"
        />

        <h3 className="text-sm font-medium text-foreground mt-4">Output Schema</h3>
        <p className="text-sm text-muted leading-relaxed">
          When defined, the LLM is forced to respond via tool-calling with valid JSON that
          conforms to this schema. When not defined, the LLM returns free text as before.
        </p>
        <CodeBlock
          code={`{
  "type": "object",
  "properties": {
    "summary": { "type": "string", "description": "Brief summary of findings" },
    "confidence": { "type": "number", "description": "Confidence score 0-1" }
  },
  "required": ["summary", "confidence"]
}`}
          language="json"
        />
      </Section>

      {/* 5. Agent Instructions Preview */}
      <Section icon={BookOpen} title="Agent Instructions Preview">
        <p className="text-sm text-muted leading-relaxed">
          The <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">GET /agents/:id/instructions</code> endpoint
          returns everything a developer or LLM needs to call a specific agent. Use the selector below
          to preview the response for any agent in your workspace.
        </p>

        <AgentInstructionsPreview workspaceId={workspaceId ?? ""} />
      </Section>

      {/* 6. Error Responses */}
      <Section icon={AlertCircle} title="Error Responses">
        <p className="text-sm text-muted leading-relaxed">
          All errors return a structured JSON body with an HTTP status code:
        </p>

        <CodeBlock
          code={`{
  "error": "Human-readable message",
  "code": "INVALID_API_KEY | PROJECT_NOT_FOUND | VALIDATION_ERROR | ..."
}`}
          language="json"
        />

        <div className="text-sm text-muted leading-relaxed space-y-1.5">
          <p className="font-medium text-foreground">Common error codes:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">INVALID_API_KEY</code> — The Bearer token is missing, revoked, or doesn't exist
            </li>
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">PROJECT_NOT_FOUND</code> — The project doesn't exist or doesn't belong to this workspace
            </li>
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">VALIDATION_ERROR</code> — Parameters don't match the expected schema (type or required fields)
            </li>
            <li>
              <code className="text-accent text-xs px-1 py-0.5 bg-elevated rounded">RUN_NOT_FOUND</code> — The run ID doesn't exist or doesn't belong to this workspace
            </li>
          </ul>
        </div>
      </Section>

      {/* 7. Quick Start */}
      <Section icon={Code2} title="Quick Start">
        <p className="text-sm text-muted leading-relaxed">
          Here's a complete example — discover the schema, trigger a run, and poll for the result:
        </p>

        <CodeBlock
          code={`# 1. Discover agent schemas
SCHEMA=$(curl -s -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/schema?workspaceId=${workspaceId ?? "<wsId>"}&projectId=<projId>")
echo "$SCHEMA" | jq .

# 2. Get instructions for a specific agent
INSTRUCTIONS=$(curl -s -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/agents/<agentId>/instructions?workspaceId=${workspaceId ?? "<wsId>"}&projectId=<projId>")
echo "$INSTRUCTIONS" | jq .

# 3. Trigger a run
RUN=$(curl -s -X POST -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspaceId": "<wsId>",
    "projectId": "<projId>",
    "parameters": {
      "customer_id": "12345",
      "usage_amount": 1500.50
    }
  }' \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs")
RUN_ID=$(echo "$RUN" | jq -r '.runId')
echo "Run ID: $RUN_ID"

# 4. Poll until complete
while true; do
  RESULT=$(curl -s -H "Authorization: Bearer sk_..." \\
    "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs/$RUN_ID?workspaceId=<wsId>&projectId=<projId>")
  STATUS=$(echo "$RESULT" | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "$RESULT" | jq .
    break
  fi
  sleep 2
done`}
          language="bash"
        />
      </Section>
    </div>
  );
}