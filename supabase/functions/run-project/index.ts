import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, type LLMMessage, type LLMProvider } from "../_shared/provider-adapter.ts";
import { validateAgainstSchema, schemaToDescription } from "../_shared/validate.ts";
import { decryptKey } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");

function getProviderEnvKeyName(provider: string): string {
  return provider === "groq" ? "GROQ_API_KEY"
    : provider === "openai" ? "OPENAI_API_KEY"
    : "ANTHROPIC_API_KEY";
}

interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  provider: LLMProvider;
  model: string;
  temperature: number;
  max_tokens: number;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
}

interface Dependency {
  agent_id: string;
  depends_on_agent_id: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- 0. Internal auth (Issue 8) ---
    if (!INTERNAL_SECRET) {
      return new Response(JSON.stringify({ error: "INTERNAL_SECRET not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const incomingSecret = req.headers.get("X-Internal-Secret");
    if (!incomingSecret || incomingSecret !== INTERNAL_SECRET) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const runId = body.runId;
    const parameters: Record<string, unknown> | undefined = body.parameters;

    if (!runId) {
      return new Response(JSON.stringify({ error: "runId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- 1. Load the run ---
    const { data: existingRun, error: runLookupErr } = await supabase
      .from("runs")
      .select("project_id, workspace_id, status")
      .eq("id", runId)
      .single();

    if (runLookupErr || !existingRun) {
      return new Response(JSON.stringify({ error: "Run not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Idempotency guard (Issue 7) ---
    if (existingRun.status === "running" || existingRun.status === "completed") {
      return new Response(
        JSON.stringify({
          error: "Run already processed",
          code: "RUN_ALREADY_PROCESSED",
          status: existingRun.status,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (parameters && Object.keys(parameters).length > 0) {
      await supabase.from("runs").update({ parameters }).eq("id", runId);
    }

    await supabase.from("runs").update({ status: "running" }).eq("id", runId);

    const projectId = existingRun.project_id;
    const workspaceId = existingRun.workspace_id;

    // --- 2. Load project ---
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, workspace_id")
      .eq("id", projectId)
      .single();

    if (projectErr || !project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 3. Load agents & dependencies ---
    const { data: agentsData, error: agentsErr } = await supabase
      .from("agents")
      .select("*")
      .eq("project_id", projectId);

    if (agentsErr) {
      return new Response(JSON.stringify({ error: "Failed to load agents" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agents: Agent[] = (agentsData ?? []).map((a: Record<string, unknown>) => ({
      ...a,
      provider: a.provider as LLMProvider,
      input_schema: a.input_schema as Record<string, unknown> | null,
      output_schema: a.output_schema as Record<string, unknown> | null,
    }));

    if (agents.length === 0) {
      return new Response(JSON.stringify({ error: "No agents in project" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentIds = agents.map((a) => a.id);

    // --- Scoped dependency query (Issue 5) ---
    const { data: depsData } = await supabase
      .from("agent_dependencies")
      .select("agent_id, depends_on_agent_id")
      .in("agent_id", agentIds);

    const deps: Dependency[] = depsData ?? [];

    // Build agent_id -> param name map from input_schema
    const agentParamMap = new Map<string, Set<string>>();
    for (const agent of agents) {
      const schema = agent.input_schema;
      if (schema?.properties && typeof schema.properties === "object") {
        const names = new Set(Object.keys(schema.properties as Record<string, unknown>));
        if (names.size > 0) {
          agentParamMap.set(agent.id, names);
        }
      }
    }

    // --- 4. Load workspace-specific API keys (Issue 1 - BYOK) ---
    const neededProviders = [...new Set(agents.map((a) => a.provider))];

    // Fetch workspace-specific keys from the api_keys table
    const { data: workspaceKeys } = await supabase
      .from("api_keys")
      .select("provider, api_key_encrypted")
      .eq("workspace_id", workspaceId)
      .in("provider", neededProviders);

    const workspaceKeyMap = new Map<string, string>();
    for (const wk of workspaceKeys ?? []) {
      try {
        const decrypted = await decryptKey(wk.api_key_encrypted);
        workspaceKeyMap.set(wk.provider, decrypted);
      } catch {
        // Decryption failed — will fall back to global env secret below
      }
    }

    // Resolve API key for each provider: workspace-specific key takes priority,
    // fall back to global env secret.
    const resolvedApiKeys = new Map<string, string>();
    const missingKeys: string[] = [];
    for (const provider of neededProviders) {
      const wsKey = workspaceKeyMap.get(provider);
      if (wsKey) {
        resolvedApiKeys.set(provider, wsKey);
        continue;
      }
      const globalKeyName = getProviderEnvKeyName(provider);
      const globalKey = Deno.env.get(globalKeyName);
      if (globalKey) {
        resolvedApiKeys.set(provider, globalKey);
        continue;
      }
      missingKeys.push(globalKeyName);
    }

    if (missingKeys.length > 0) {
      const now = new Date().toISOString();
      await supabase.from("runs").update({
        status: "failed",
        error: `Missing provider keys: ${missingKeys.join(", ")}`,
        completed_at: now,
      }).eq("id", runId);

      await supabase.from("agent_runs").insert(
        agents.map((a) => ({
          run_id: runId,
          agent_id: a.id,
          status: "failed",
          provider: a.provider,
          model: a.model,
          error: `${a.provider.toUpperCase()}_API_KEY not configured`,
          started_at: now,
          completed_at: now,
        })),
      );

      return new Response(
        JSON.stringify({ error: `Missing provider keys: ${missingKeys.join(", ")}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 5. Build DAG ---
    const agentMap = new Map<string, Agent>();
    for (const a of agents) agentMap.set(a.id, a);

    const depsByAgent = new Map<string, Set<string>>();
    const dependentsByAgent = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const a of agents) {
      depsByAgent.set(a.id, new Set());
      dependentsByAgent.set(a.id, new Set());
      inDegree.set(a.id, 0);
    }
    for (const d of deps) {
      depsByAgent.get(d.agent_id)?.add(d.depends_on_agent_id);
      dependentsByAgent.get(d.depends_on_agent_id)?.add(d.agent_id);
      inDegree.set(d.agent_id, (inDegree.get(d.agent_id) ?? 0) + 1);
    }

    // Topological sort
    const queue: string[] = [];
    const topoOrder: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    while (queue.length > 0) {
      const node = queue.shift()!;
      topoOrder.push(node);
      for (const dep of dependentsByAgent.get(node) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }

    if (topoOrder.length !== agents.length) {
      return new Response(JSON.stringify({ error: "Cycle detected in agent dependencies" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 6. Create agent_runs rows ---
    const agentRunRows = agents.map((a) => ({
      run_id: runId,
      agent_id: a.id,
      status: "queued" as const,
      provider: a.provider,
      model: a.model,
    }));
    const { data: agentRuns } = await supabase
      .from("agent_runs")
      .insert(agentRunRows)
      .select();

    const agentRunMap = new Map<string, string>();
    for (const ar of agentRuns ?? []) {
      agentRunMap.set(ar.agent_id, ar.id);
    }

    // --- 7. Execute in waves with per-agent failure tracking (Issue 4) ---
    const outputs = new Map<string, string>();

    // Track failed/skipped agents — transitive dependents are skipped
    const failedOrSkipped = new Set<string>();

    // Partition topoOrder into parallel waves
    const waves: string[][] = [];
    const waveInDegree = new Map<string, number>();
    for (const [id, deg] of inDegree) waveInDegree.set(id, deg);
    const processed = new Set<string>();

    while (processed.size < topoOrder.length) {
      const wave: string[] = [];
      for (const id of topoOrder) {
        if (processed.has(id)) continue;
        if ((waveInDegree.get(id) ?? 0) === 0) {
          wave.push(id);
        }
      }
      if (wave.length === 0) break;
      waves.push(wave);
      for (const id of wave) processed.add(id);
    }

    for (const wave of waves) {
      await Promise.allSettled(
        wave.map(async (agentId) => {
          const agent = agentMap.get(agentId)!;
          const arId = agentRunMap.get(agentId)!;
          const depsList = depsByAgent.get(agentId) ?? new Set();

          // --- Per-agent dependency check (Issue 4) ---
          // If any transitive dependency failed or was skipped, skip this agent too.
          let shouldSkip = false;
          let skipReason = "";
          for (const depId of depsList) {
            if (failedOrSkipped.has(depId)) {
              const depAgent = agentMap.get(depId);
              shouldSkip = true;
              skipReason = `Dependency agent "${depAgent?.name ?? depId}" failed`;
              break;
            }
          }

          if (shouldSkip) {
            failedOrSkipped.add(agentId);
            await supabase
              .from("agent_runs")
              .update({
                status: "skipped",
                error: skipReason,
                completed_at: new Date().toISOString(),
              })
              .eq("id", arId);

            // Unblock dependents (they'll also check and skip)
            const dependents = dependentsByAgent.get(agentId) ?? new Set();
            for (const depId of dependents) {
              waveInDegree.set(depId, (waveInDegree.get(depId) ?? 1) - 1);
            }
            return;
          }

          await supabase
            .from("agent_runs")
            .update({ status: "running", started_at: new Date().toISOString() })
            .eq("id", arId);

          // Build messages
          const messages: LLMMessage[] = [
            { role: "system", content: agent.system_prompt },
          ];

          // Inject agent-specific parameters from input_schema
          const agentParamNames = agentParamMap.get(agentId);
          if (parameters && agentParamNames && agentParamNames.size > 0) {
            const agentParams: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(parameters)) {
              if (agentParamNames.has(k)) {
                agentParams[k] = v;
              }
            }
            if (Object.keys(agentParams).length > 0) {
              const paramLines = Object.entries(agentParams)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n");
              messages.push({
                role: "user",
                content: "Agent parameters:\n\n" + paramLines,
              });
            }
          }

          // Inject dependency outputs
          if (depsList.size > 0) {
            const depBlocks: string[] = [];
            for (const depId of depsList) {
              const depAgent = agentMap.get(depId);
              const depOutput = outputs.get(depId) ?? "";
              depBlocks.push(
                `--- Output from ${depAgent?.name ?? depId} ---\n${depOutput}`,
              );
            }
            messages.push({
              role: "user",
              content: "Dependency outputs:\n\n" + depBlocks.join("\n\n"),
            });
          }

          // Final instruction for structured output
          if (agent.output_schema) {
            const outputDesc = schemaToDescription(agent.output_schema, "Expected output format");
            messages.push({
              role: "user",
              content:
                `Based on the context above, produce the output in the following structured format. Your response MUST use the submit_result tool with valid JSON matching the schema.\n\n${outputDesc}`,
            });
          }

          const inputPrompt = messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");

          try {
            const toolSchema = agent.output_schema ?? undefined;
            const apiKey = resolvedApiKeys.get(agent.provider)!;

            const result = await callLLM(
              agent.provider,
              agent.model,
              messages,
              agent.temperature,
              agent.max_tokens,
              apiKey,
              toolSchema ? (toolSchema as Record<string, unknown>) : undefined,
            );

            let outputContent: string;
            if (result.toolCallArguments) {
              const validationError = validateAgainstSchema(
                result.toolCallArguments,
                agent.output_schema,
              );
              if (validationError) {
                throw new Error(
                  `LLM returned invalid structured output: ${validationError}`,
                );
              }
              outputContent = JSON.stringify(result.toolCallArguments);
            } else {
              outputContent = result.content ?? "";
            }

            outputs.set(agentId, outputContent);

            const completedAt = new Date().toISOString();
            await supabase
              .from("agent_runs")
              .update({
                status: "completed",
                input_prompt: inputPrompt,
                output: outputContent,
                prompt_tokens: result.promptTokens,
                completion_tokens: result.completionTokens,
                total_tokens: result.totalTokens,
                completed_at: completedAt,
              })
              .eq("id", arId);

            const dependents = dependentsByAgent.get(agentId) ?? new Set();
            for (const depId of dependents) {
              waveInDegree.set(depId, (waveInDegree.get(depId) ?? 1) - 1);
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            outputs.set(agentId, "");
            failedOrSkipped.add(agentId);

            const completedAt = new Date().toISOString();
            await supabase
              .from("agent_runs")
              .update({
                status: "failed",
                input_prompt: inputPrompt,
                error: errMsg,
                completed_at: completedAt,
              })
              .eq("id", arId);

            // Unblock dependents — they'll see the failure and skip themselves
            const dependents = dependentsByAgent.get(agentId) ?? new Set();
            for (const depId of dependents) {
              waveInDegree.set(depId, (waveInDegree.get(depId) ?? 1) - 1);
            }
          }
        }),
      );
    }

    // --- 8. Finalize ---
    const anyFailed = agents.some((a) => {
      const ar = agentRunMap.get(a.id);
      // We check if any agent_run was marked failed
      return false; // computed below via DB read
    });

    // Reload agent_runs to determine final status
    const { data: finalAgentRuns } = await supabase
      .from("agent_runs")
      .select("status")
      .eq("run_id", runId);

    const hasFailed = (finalAgentRuns ?? []).some((ar) => ar.status === "failed");
    const hasSkipped = (finalAgentRuns ?? []).some((ar) => ar.status === "skipped");
    const allCompleted = (finalAgentRuns ?? []).every((ar) => ar.status === "completed");

    let finalStatus: string;
    if (hasFailed) {
      finalStatus = "failed";
    } else if (allCompleted && !hasSkipped) {
      finalStatus = "completed";
    } else {
      finalStatus = "completed"; // partial skip is still "completed" for the run
    }

    await supabase
      .from("runs")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return new Response(
      JSON.stringify({ runId, status: finalStatus }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
        "Content-Type": "application/json",
      },
    });
  }
});