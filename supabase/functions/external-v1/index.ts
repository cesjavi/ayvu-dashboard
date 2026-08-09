import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateAgainstSchema } from "../_shared/validate.ts";
import { fetchRunResult } from "../_shared/run-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Auth – API key lookup (not JWT)
// ---------------------------------------------------------------------------

async function authenticate(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<
  { workspaceId: string; keyId: string }
  | { error: string; code: string; status: number }
> {
  if (!authHeader) {
    return { error: "Missing Authorization header", code: "MISSING_AUTH", status: 401 };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return { error: "Invalid Authorization header format", code: "INVALID_AUTH_FORMAT", status: 401 };
  }

  const keyHash = await hashKey(token);

  const { data: apiKey, error: keyErr } = await supabase
    .from("workspace_api_keys")
    .select("id, workspace_id, is_revoked")
    .eq("key_hash", keyHash)
    .single();

  if (keyErr || !apiKey) {
    return { error: "Invalid API key", code: "INVALID_API_KEY", status: 401 };
  }

  if (apiKey.is_revoked) {
    return { error: "API key has been revoked", code: "REVOKED_API_KEY", status: 401 };
  }

  // Fire-and-forget – update last_used_at (never block the request)
  supabase
    .from("workspace_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});

  return { workspaceId: apiKey.workspace_id, keyId: apiKey.id };
}

// ---------------------------------------------------------------------------
// Project-access guard
// ---------------------------------------------------------------------------

async function verifyProjectAccess(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  workspaceId: string,
): Promise<{ project: Record<string, unknown> } | { error: string; code: string; status: number }> {
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", projectId)
    .single();

  if (pErr || !project) {
    return { error: "Project not found", code: "PROJECT_NOT_FOUND", status: 404 };
  }

  if (project.workspace_id !== workspaceId) {
    return { error: "Project does not belong to this workspace", code: "ACCESS_DENIED", status: 403 };
  }

  return { project: project as unknown as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleGetSchema(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  url: URL,
): Promise<Response> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return jsonResponse({ error: "projectId query parameter is required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const access = await verifyProjectAccess(supabase, projectId, workspaceId);
  if ("error" in access) {
    return jsonResponse({ error: access.error, code: access.code }, access.status);
  }

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, description, input_schema, output_schema")
    .eq("project_id", projectId);

  return jsonResponse({ projectId, agents: agents ?? [] });
}

async function handlePostRun(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const projectId = body.projectId as string | undefined;
  const parameters = body.parameters as Record<string, unknown> | undefined;

  if (!projectId) {
    return jsonResponse({ error: "projectId is required", code: "MISSING_PROJECT_ID" }, 400);
  }

  const access = await verifyProjectAccess(supabase, projectId, workspaceId);
  if ("error" in access) {
    return jsonResponse({ error: access.error, code: access.code }, access.status);
  }

  // Load agents to validate parameters against input_schema
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, input_schema")
    .eq("project_id", projectId);

  if (!agents || agents.length === 0) {
    return jsonResponse({ error: "No agents in project", code: "NO_AGENTS" }, 400);
  }

  // --- Full schema validation (Issue 9) ---
  // Validate parameters against each agent's input_schema, including type checks.
  if (parameters && typeof parameters === "object") {
    for (const agent of agents) {
      const schema = agent.input_schema as Record<string, unknown> | undefined;
      if (!schema?.properties || typeof schema.properties !== "object") continue;

      const validationError = validateAgainstSchema(parameters, schema);
      if (validationError) {
        return jsonResponse({
          error: `Parameter validation failed for agent "${agent.name}": ${validationError}`,
          code: "VALIDATION_ERROR",
        }, 400);
      }
    }
  }

  // Create the run
  const { data: run, error: runErr } = await supabase
    .from("runs")
    .insert({
      project_id: projectId,
      workspace_id: workspaceId,
      status: "queued",
      parameters: parameters ?? {},
    })
    .select()
    .single();

  if (runErr || !run) {
    return jsonResponse({ error: "Failed to create run", code: "RUN_CREATE_FAILED" }, 500);
  }

  // Kick off the cascade asynchronously (fire-and-forget) with internal auth (Issue 8)
  const runProjectUrl = `${SUPABASE_URL}/functions/v1/run-project`;
  fetch(runProjectUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify({ runId: run.id, parameters: parameters ?? {} }),
  }).catch(() => {});

  return jsonResponse({ runId: run.id, status: "queued" }, 202);
}

async function handleGetRun(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  runId: string,
): Promise<Response> {
  if (!runId) {
    return jsonResponse({ error: "runId path parameter is required", code: "MISSING_RUN_ID" }, 400);
  }

  // Use shared fetcher (Issue 10), then verify workspace ownership
  try {
    const result = await fetchRunResult(supabase, runId);
    // Verify workspace access (shared fetcher doesn't filter by workspace)
    if (result.run.workspace_id !== workspaceId) {
      return jsonResponse({ error: "Run not found", code: "RUN_NOT_FOUND" }, 404);
    }
    return jsonResponse(result);
  } catch (err: unknown) {
    const e = err as { error?: string; code?: string; status?: number };
    return jsonResponse({ error: e.error ?? "Run not found", code: e.code ?? "RUN_NOT_FOUND" }, e.status ?? 404);
  }
}

async function handleListProjects(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<Response> {
  const { data: projects, error: pErr } = await supabase
    .from("projects")
    .select("id, name, description, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (pErr) {
    return jsonResponse({ error: "Failed to fetch projects", code: "FETCH_FAILED" }, 500);
  }

  return jsonResponse({ projects: projects ?? [] });
}

// ---------------------------------------------------------------------------
// Agent Instructions Handler
// ---------------------------------------------------------------------------

async function handleAgentInstructions(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  agentId: string,
): Promise<Response> {
  // Load the agent with its project to verify workspace access
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("*, projects!inner(id, name, workspace_id)")
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) {
    return jsonResponse({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, 404);
  }

  const project = Array.isArray(agent.projects) ? agent.projects[0] : agent.projects;
  if (project?.workspace_id !== workspaceId) {
    return jsonResponse({ error: "Agent does not belong to this workspace", code: "ACCESS_DENIED" }, 403);
  }

  const inputSchema = agent.input_schema as Record<string, unknown> | null;
  const outputSchema = agent.output_schema as Record<string, unknown> | null;

  // Build sample request parameters from input_schema
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

  // Build sample response from output_schema
  let sampleResponse: Record<string, unknown> = {};
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
            : p.type === "array"
              ? []
              : `sample_${key}_result`;
      sampleResponse[key] = val;
    }
  }

  const projectId = project?.id ?? "";
  const curlCreateRun = `curl -X POST \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{
  "projectId": "${projectId}",
  "parameters": ${JSON.stringify(sampleParams, null, 2)}
}' \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs"`;

  const sampleRunId = crypto.randomUUID();
  const curlPollResult = `curl -H "Authorization: Bearer sk_..." \\
  "${SUPABASE_URL}/functions/v1/external-v1/api/v1/runs/${sampleRunId}?workspaceId=${workspaceId}&projectId=${projectId}"`;

  const inputSchemaDescription = inputSchema?.description
    ? (inputSchema.description as string)
    : "This agent accepts the following parameters as input.";
  const outputSchemaDescription = outputSchema?.description
    ? (outputSchema.description as string)
    : "This agent produces the following structured output.";

  // Natural language explanation of the full flow
  const flowExplanation = `To use this agent, follow these steps:

1. **Trigger a run** — Send a POST request to \`/api/v1/runs\` with the project ID and the parameters listed in \`input_schema\`. The API returns a \`runId\` immediately.

2. **Poll for completion** — Poll \`GET /api/v1/runs/:runId\` every 2–3 seconds until the status changes from \`queued\`/ \`running\` to \`completed\` or \`failed\`.

3. **Read the output** — Once the run is complete, the \`agent_runs\` array contains each agent's output. For this agent, look for the entry with \`agent_id\` equal to "${agentId}". ${
  outputSchema
    ? "The \`output\` field will be a JSON string that conforms to the \`output_schema\` above — parse it to get the structured result."
    : "The \`output\` field contains the raw text response from the LLM."
}

**Tip:** First discover all agents in a project via \`GET /api/v1/schema?projectId=...\` to understand the full cascade.`;

  return jsonResponse({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      provider: agent.provider,
      model: agent.model,
    },
    project: {
      id: projectId,
      name: project?.name ?? "",
    },
    input_schema: inputSchema ?? {},
    output_schema: outputSchema ?? null,
    input_schema_description: inputSchemaDescription,
    output_schema_description: outputSchemaDescription,
    sample_request: {
      method: "POST",
      path: "/api/v1/runs",
      curl: curlCreateRun,
      body: {
        projectId,
        parameters: sampleParams,
      },
    },
    sample_response: {
      poll_curl: curlPollResult,
      expected_output: outputSchema ? sampleResponse : "(free text response)",
    },
    flow_explanation: flowExplanation,
  });
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // Authenticate every request with API key
    const auth = await authenticate(supabase, req.headers.get("Authorization"));
    if ("error" in auth) {
      return jsonResponse({ error: auth.error, code: auth.code }, auth.status);
    }

    const url = new URL(req.url);
    // Supabase runtime strips /functions/v1/<slug> from req.url, but the slug
    // (the function name) remains as the first path segment — strip it too.
    const functionSlug = 'external-v1';
    const path = url.pathname.replace(new RegExp(`^/${functionSlug}`), '') || '/';

    // GET /api/v1/schema?projectId=<uuid>
    if (req.method === "GET" && path === "/api/v1/schema") {
      return await handleGetSchema(supabase, auth.workspaceId, url);
    }

    // POST /api/v1/runs
    if (req.method === "POST" && path === "/api/v1/runs") {
      const body = await req.json() as Record<string, unknown>;
      return await handlePostRun(supabase, auth.workspaceId, body);
    }

    // GET /api/v1/projects
    if (req.method === "GET" && path === "/api/v1/projects") {
      return await handleListProjects(supabase, auth.workspaceId);
    }

    // GET /api/v1/runs/<runId>
    const runsMatch = path.match(/^\/api\/v1\/runs\/([a-f0-9-]+)$/i);
    if (req.method === "GET" && runsMatch) {
      return await handleGetRun(supabase, auth.workspaceId, runsMatch[1]);
    }

    // GET /api/v1/agents/<agentId>/instructions
    const agentInstructionsMatch = path.match(/^\/api\/v1\/agents\/([a-f0-9-]+)\/instructions$/i);
    if (req.method === "GET" && agentInstructionsMatch) {
      return await handleAgentInstructions(supabase, auth.workspaceId, agentInstructionsMatch[1]);
    }

    return jsonResponse({ error: "Not found", code: "NOT_FOUND" }, 404);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: errMsg, code: "INTERNAL_ERROR" }, 500);
  }
});