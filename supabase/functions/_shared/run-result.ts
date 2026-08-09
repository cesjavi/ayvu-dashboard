// ---------------------------------------------------------------------------
// Shared run + agent_runs fetcher — used by both external-v1 (service-role)
// and get-run-result (anon+JWT / RLS).
// ---------------------------------------------------------------------------

export interface RunResult {
  run: Record<string, unknown>;
  project: { id: string; name: string };
  agent_runs: Record<string, unknown>[];
}

/**
 * Fetch a run by ID and its associated agent_runs using the provided Supabase client.
 * The caller is responsible for any access control (RLS or explicit workspace filter).
 */
export async function fetchRunResult(
  supabase: ReturnType<typeof createClient>,
  runId: string,
): Promise<RunResult> {
  const { data: run, error: runErr } = await supabase
    .from("runs")
    .select("*, projects!inner(id, name)")
    .eq("id", runId)
    .single();

  if (runErr || !run) {
    throw { error: "Run not found", code: "RUN_NOT_FOUND", status: 404 };
  }

  const { data: agentRuns } = await supabase
    .from("agent_runs")
    .select("*, agents!inner(name)")
    .eq("run_id", runId)
    .order("started_at", { ascending: true, nullsFirst: false });

  const { projects, ...runFields } = run;
  const project = Array.isArray(projects) ? projects[0] : projects;

  return {
    run: {
      ...runFields,
      parameters: run.parameters ?? {},
    },
    project: {
      id: project?.id ?? "",
      name: project?.name ?? "",
    },
    agent_runs: (agentRuns ?? []).map((ar) => {
      const { agents: agentArr, ...arFields } = ar;
      return {
        ...arFields,
        agent_name: (Array.isArray(agentArr) ? agentArr[0] : agentArr)?.name ?? "Unknown",
      };
    }),
  };
}

// Avoid importing createClient for the type; use a minimal interface match.
// We need to import createClient from supabase-js but this is a Deno module.
import { createClient } from "jsr:@supabase/supabase-js@2";