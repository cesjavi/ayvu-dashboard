import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, XCircle, Clock, SkipForward, GitBranch, SlidersHorizontal } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate, formatDuration } from "../lib/utils";
import type { DagAgent, DagDependency, AgentStatus } from "../components/DagCanvas";

// React Flow is heavy (~440KB) – lazy-load it only when needed
const DagCanvas = lazy(() => import("../components/DagCanvas"));

interface Run {
  id: string;
  project_id: string;
  status: string;
  triggered_by: string | null;
  error: string | null;
  parameters: Record<string, string> | null;
  created_at: string;
  completed_at: string | null;
}

interface AgentRun {
  id: string;
  agent_id: string;
  status: string;
  input_prompt: string | null;
  output: string | null;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  agents: { name: string } | null;
}

export default function RunDetailPage() {
  const { workspaceId, projectId, runId } = useParams<{
    workspaceId: string;
    projectId: string;
    runId: string;
  }>();
  const [run, setRun] = useState<Run | null>(null);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agents, setAgents] = useState<DagAgent[]>([]);
  const [dependencies, setDependencies] = useState<DagDependency[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDag, setShowDag] = useState(true);

  useEffect(() => {
    if (!runId) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const [runRes, arRes] = await Promise.all([
        supabase.from("runs").select("*").eq("id", runId).single(),
        supabase
          .from("agent_runs")
          .select("*, agents!inner(name)")
          .eq("run_id", runId)
          .order("started_at" as any),
      ]);

      if (runRes.data) {
        setRun(runRes.data);
        // Stop polling when terminal
        if (
          runRes.data.status === "completed" ||
          runRes.data.status === "failed"
        ) {
          if (interval) clearInterval(interval);
        }
      }
      if (arRes.data) setAgentRuns(arRes.data as any);
      setLoading(false);
    };

    poll();
    interval = setInterval(poll, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [runId]);

  // Load agents + dependencies for the DAG
  useEffect(() => {
    if (!projectId) return;

    const loadGraph = async () => {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, name, provider, model")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (agentData) setAgents(agentData as DagAgent[]);

      const agentIds = agentData?.map((a) => a.id) ?? [];
      if (agentIds.length > 0) {
        const { data: deps } = await supabase
          .from("agent_dependencies")
          .select("agent_id, depends_on_agent_id")
          .in("agent_id", agentIds);
        if (deps) setDependencies(deps as DagDependency[]);
      }
    };

    loadGraph();
  }, [projectId]);

  // Build status map from agent runs (idle for agents with no run record yet)
  const agentStatuses: Record<string, AgentStatus> = {};
  for (const ar of agentRuns) {
    agentStatuses[ar.agent_id] = (ar.status as AgentStatus) ?? "idle";
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 size={16} className="text-success" />;
      case "failed":
        return <XCircle size={16} className="text-destructive" />;
      case "running":
        return <Clock size={16} className="text-accent animate-spin" />;
      case "skipped":
        return <SkipForward size={16} className="text-muted" />;
      default:
        return <Clock size={16} className="text-warning" />;
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div className="h-8 skeleton w-48" />
        <div className="h-12 skeleton" />
        <div className="h-64 skeleton" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 text-center text-muted">Run not found</div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back */}
      <Link
        to={`/workspace/${workspaceId}/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors duration-150 mb-4 cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to project
      </Link>

      {/* Run header */}
      <div className="bg-surface border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-medium capitalize ${
                run.status === "completed"
                  ? "text-success"
                  : run.status === "failed"
                    ? "text-destructive"
                    : run.status === "running"
                      ? "text-accent"
                      : "text-warning"
              }`}
            >
              {run.status}
            </span>
          </div>
          <span className="text-xs text-muted">
            {formatDate(run.created_at)}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted">
          <span>Started {formatDate(run.created_at)}</span>
          {run.completed_at && (
            <span>
              Duration: {formatDuration(run.created_at, run.completed_at)}
            </span>
          )}
        </div>
        {run.error && (
          <p className="text-sm text-destructive mt-2 bg-destructive/10 rounded-md px-3 py-2">
            {run.error}
          </p>
        )}

        {/* Parameters used for this run */}
        {run.parameters && Object.keys(run.parameters).length > 0 && (
          <div className="mt-3 bg-elevated/50 rounded-md px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-muted font-medium mb-1.5">
              <SlidersHorizontal size={13} />
              Parameters
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(run.parameters).map(([key, value]) => (
                <span key={key} className="text-xs">
                  <code className="text-muted">{key}:</code>{" "}
                  <span className="text-foreground/80">{value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* DAG visualization */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6 animate-fade-in">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <button
            onClick={() => setShowDag(!showDag)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-accent transition-colors duration-150 cursor-pointer"
          >
            <GitBranch size={16} />
            Agent dependency graph
          </button>
          <span className="text-xs text-muted">
            {agents.length} agents · {dependencies.length} dependencies
          </span>
        </div>
        {showDag && (
          <div className="h-[300px] border-b border-border">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
              <DagCanvas
                agents={agents}
                dependencies={dependencies}
                agentStatuses={agentStatuses}
              />
            </Suspense>
          </div>
        )}
        <div className="px-4 py-2 flex items-center gap-4 text-xs text-muted flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-border inline-block" />
            Ready
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-warning inline-block" />
            Queued
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent inline-block" />
            Running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success inline-block" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-border inline-block" />
            Skipped
          </span>
          <span className="ml-auto hidden sm:block">
            Scroll to zoom · drag to pan
          </span>
        </div>
      </div>

      {/* Agent runs */}
      <h2 className="text-sm font-medium text-foreground mb-3">
        Agent executions
      </h2>

      <div className="space-y-2">
        {agentRuns.map((ar) => (
          <div
            key={ar.id}
            className="bg-surface border border-border rounded-lg overflow-hidden"
          >
            <button
              onClick={() =>
                setExpanded(expanded === ar.id ? null : ar.id)
              }
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-elevated transition-all duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {statusIcon(ar.status)}
                <span className="text-sm text-foreground">
                  {ar.agents?.name ?? "Unknown agent"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                {ar.total_tokens && (
                  <span>{ar.total_tokens} tokens</span>
                )}
                <span className="capitalize">{ar.status}</span>
              </div>
            </button>

            {expanded === ar.id && (
              <div className="px-4 pb-4 space-y-3 border-t border-border animate-fade-in">
                {ar.error && (
                  <div className="mt-3 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {ar.error}
                  </div>
                )}

                {ar.input_prompt && (
                  <div>
                    <p className="text-xs text-muted font-medium mb-1">
                      Input prompt
                    </p>
                    <pre className="text-xs text-foreground/80 bg-elevated rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {ar.input_prompt}
                    </pre>
                  </div>
                )}

                {ar.output && (
                  <div>
                    <p className="text-xs text-muted font-medium mb-1">
                      Output
                    </p>
                    <pre className="text-xs text-foreground/80 bg-elevated rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                      {ar.output}
                    </pre>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 text-xs text-muted">
                  {ar.model && <span>Model: {ar.model}</span>}
                  {ar.provider && <span>Provider: {ar.provider}</span>}
                  {ar.prompt_tokens !== null && (
                    <span>Prompt tokens: {ar.prompt_tokens}</span>
                  )}
                  {ar.completion_tokens !== null && (
                    <span>
                      Completion tokens: {ar.completion_tokens}
                    </span>
                  )}
                  {ar.total_tokens !== null && (
                    <span>Total tokens: {ar.total_tokens}</span>
                  )}
                  {ar.started_at && ar.completed_at && (
                    <span>
                      Duration:{" "}
                      {formatDuration(ar.started_at, ar.completed_at)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}