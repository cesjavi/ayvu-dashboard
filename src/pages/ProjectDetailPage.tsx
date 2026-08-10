import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Plus, Bot, Play, Clock, Trash2, GitBranch, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { formatDate, formatDuration } from "../lib/utils";
import RunParamsModal from "../components/RunParamsModal";
import type { DagAgent, DagDependency } from "../components/DagCanvas";

// React Flow is heavy (~440KB) – lazy-load it only when the DAG is opened
const DagCanvas = lazy(() => import("../components/DagCanvas"));

interface Project {
  id: string;
  name: string;
  description: string;
  workspace_id: string;
}

interface Agent {
  id: string;
  name: string;
  provider: string;
  model: string;
  created_at: string;
}

interface Run {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

interface ProjectParam {
  id: string;
  name: string;
  label: string;
  description: string;
  required: boolean;
  agent_name: string;
}

export default function ProjectDetailPage() {
  const { workspaceId, projectId } = useParams<{
    workspaceId: string;
    projectId: string;
  }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dependencies, setDependencies] = useState<DagDependency[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [params, setParams] = useState<ProjectParam[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDag, setShowDag] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!projectId || !workspaceId) return;
    loadProject();
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (!projectId) return;
    // Subscribe to run status changes
    const channel = supabase
      .channel("runs-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "runs",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          loadRuns();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const loadProject = async () => {
    setLoading(true);

    // Load project info + agents + runs + params in parallel
    const [projRes, agentsRes, runsRes, paramsRes] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, description, workspace_id")
        .eq("id", projectId)
        .single(),
      supabase
        .from("agents")
        .select("id, name, provider, model, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      supabase
        .from("runs")
        .select("id, status, created_at, completed_at, error")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("project_params")
        .select("id, name, label, description, required, agents(name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
    ]);

    if (projRes.data) setProject(projRes.data);
    if (agentsRes.data) setAgents(agentsRes.data);
    if (runsRes.data) setRuns(runsRes.data);
    if (paramsRes.data) {
      setParams(
        paramsRes.data.map((p) => ({
          ...p,
          agent_name: (p.agents as unknown as { name: string } | null)?.name ?? "Unknown",
        }))
      );
    }

    // Load dependencies for all agents in this project
    const agentIds = agentsRes.data?.map((a) => a.id) ?? [];
    if (agentIds.length > 0) {
      const { data: deps } = await supabase
        .from("agent_dependencies")
        .select("agent_id, depends_on_agent_id")
        .in("agent_id", agentIds);
      if (deps) setDependencies(deps);
    }

    setLoading(false);
  };

  const loadRuns = async () => {
    const { data } = await supabase
      .from("runs")
      .select("id, status, created_at, completed_at, error")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setRuns(data);
  };

  const triggerRun = async () => {
    if (!projectId || !workspaceId || !project || running) return;

    // If the project has parameters, ask for values first
    if (params.length > 0) {
      setShowRunModal(true);
      return;
    }

    await startRun({});
  };

  const startRun = async (parameterValues: Record<string, string>) => {
    if (!projectId || !workspaceId || !project || running) return;
    setRunning(true);
    setShowRunModal(false);
    try {
      // 1. Insert the run row (status: queued) with parameter snapshot
      const { data: newRun, error: insertErr } = await supabase
        .from("runs")
        .insert({
          project_id: projectId,
          workspace_id: workspaceId,
          status: "queued",
          triggered_by: user?.id ?? null,
          parameters: Object.keys(parameterValues).length > 0 ? parameterValues : null,
        })
        .select("id")
        .single();

      if (insertErr || !newRun) {
        console.error("Failed to create run:", insertErr);
        setRunning(false);
        return;
      }

      // 2. Fire the edge function WITHOUT awaiting (fire-and-forget)
      supabase.functions.invoke("run-project", {
        body: { runId: newRun.id, parameters: parameterValues },
      }).catch((err) => console.error("Run execution error:", err));

      // 3. Refresh run list
      loadRuns();
    } catch (err) {
      console.error("Failed to trigger run:", err);
    }
    setRunning(false);
  };

  const deleteAgent = async (agentId: string) => {
    await supabase.from("agents").delete().eq("id", agentId);
    setAgents(agents.filter((a) => a.id !== agentId));
  };

  const handleDeleteProject = async () => {
    if (!projectId || !project || deleting) return;
    setDeleting(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("delete-project", {
        body: { projectId },
      });

      if (err || (data && !data.success)) {
        console.error("Failed to delete project:", err ?? data);
        setDeleting(false);
        setShowDeleteConfirm(false);
        return;
      }

      // Success – navigate back to the project list
      navigate(`/workspace/${workspaceId}/projects`);
    } catch (err) {
      console.error("Failed to delete project:", err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-success";
      case "running":
        return "text-accent";
      case "failed":
        return "text-destructive";
      case "queued":
        return "text-warning";
      default:
        return "text-muted";
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="h-8 skeleton w-48" />
        <div className="h-12 skeleton" />
        <div className="h-32 skeleton" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center text-muted">
        Project not found
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back + header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            to={`/workspace/${workspaceId}/projects`}
            className="text-muted hover:text-foreground transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-heading font-semibold text-foreground">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-sm text-muted">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-sm font-medium rounded-md px-3 py-2 text-muted hover:text-destructive hover:bg-destructive/10 border border-border transition-all duration-150 active:scale-[0.98] cursor-pointer"
            title="Delete project"
          >
            <Trash2 size={16} />
          </button>
          {agents.length > 0 && (
            <button
              onClick={() => setShowDag(!showDag)}
              className={`flex items-center gap-1.5 text-sm font-medium rounded-md px-3 py-2 transition-all duration-150 active:scale-[0.98] cursor-pointer ${
                showDag
                  ? "bg-accent/10 text-accent border border-accent/30"
                  : "text-muted hover:text-foreground hover:bg-elevated border border-border"
              }`}
            >
              <GitBranch size={16} />
              DAG
            </button>
          )}
          <button
            onClick={triggerRun}
            disabled={running || agents.length === 0}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-3 py-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Play size={16} />
            {running ? "Starting…" : "Run cascade"}
          </button>
        </div>
      </div>

      {/* DAG visualization */}
      {showDag && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6 animate-fade-in">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Agent dependency graph
            </h2>
            <span className="text-xs text-muted">
              {agents.length} agents · {dependencies.length} dependencies
            </span>
          </div>
          <div className="h-[400px]">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              }
            >
              <DagCanvas
                agents={agents as DagAgent[]}
                dependencies={dependencies}
              />
            </Suspense>
          </div>
          <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 text-xs text-muted flex-wrap">
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
            <span className="ml-auto hidden sm:block">
              Scroll to zoom · drag to pan
            </span>
          </div>
        </div>
      )}

      {/* Two-column: Agents + Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agents */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-foreground">
              Agents ({agents.length})
            </h2>
            <Link
              to={`/workspace/${workspaceId}/projects/${projectId}/agents/new`}
              className="flex items-center gap-1 text-sm text-accent hover:text-accent-hover transition-colors duration-150 cursor-pointer"
            >
              <Plus size={14} />
              Add agent
            </Link>
          </div>

          {agents.length === 0 ? (
            <div className="bg-surface border border-border rounded-lg p-6 text-center">
              <Bot size={32} className="mx-auto text-muted/30 mb-2" />
              <p className="text-sm text-muted">No agents yet</p>
              <p className="text-xs text-muted/50 mt-1">
                Add your first agent to build a cascade
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <Link
                  key={agent.id}
                  to={`/workspace/${workspaceId}/projects/${projectId}/agents/${agent.id}/edit`}
                  className="block bg-surface border border-border rounded-lg p-3 hover:bg-elevated transition-all duration-150 group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground group-hover:text-accent transition-colors duration-150">
                      {agent.name}
                    </h3>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteAgent(agent.id);
                      }}
                      className="text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {agent.provider} &middot; {agent.model}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Runs */}
        <div>
          <h2 className="text-sm font-medium text-foreground mb-3">
            Recent runs
          </h2>

          {runs.length === 0 ? (
            <div className="bg-surface border border-border rounded-lg p-6 text-center">
              <Clock size={32} className="mx-auto text-muted/30 mb-2" />
              <p className="text-sm text-muted">No runs yet</p>
              <p className="text-xs text-muted/50 mt-1">
                Trigger a cascade to see results here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  to={`/workspace/${workspaceId}/projects/${projectId}/runs/${run.id}`}
                  className="block bg-surface border border-border rounded-lg p-3 hover:bg-elevated transition-all duration-150 group"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-medium ${statusColor(run.status)}`}
                    >
                      {run.status}
                    </span>
                    <div className="flex items-center gap-2">
                      {run.completed_at && (
                        <span className="text-xs text-muted">
                          {formatDuration(run.created_at, run.completed_at)}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {formatDate(run.created_at)}
                      </span>
                    </div>
                  </div>
                  {run.error && (
                    <p className="text-xs text-destructive mt-1 truncate">
                      {run.error}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Run params modal — asks for param values when the project has params */}
      {showRunModal && (
        <RunParamsModal
          params={params}
          onRun={startRun}
          onClose={() => setShowRunModal(false)}
          loading={running}
        />
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface border border-border rounded-xl w-full max-w-md p-6 animate-pop-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 shrink-0 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle size={20} className="text-destructive" />
              </div>
              <div>
                <h2
                  id="delete-project-title"
                  className="text-base font-heading font-semibold text-foreground"
                >
                  Delete "{project.name}"?
                </h2>
                <p className="text-sm text-muted mt-1.5">
                  This will permanently delete the project along with its{" "}
                  {agents.length > 0 && (
                    <>
                      {agents.length} agent{agents.length !== 1 ? "s" : ""},
                    </>
                  )}{" "}
                  {runs.length > 0 && (
                    <>
                      {runs.length} run{runs.length !== 1 ? "s" : ""},
                    </>
                  )}{" "}
                  and all related data. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="text-sm text-muted hover:text-foreground px-4 py-2 rounded-md transition-colors duration-150 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="flex items-center gap-1.5 bg-destructive hover:bg-destructive/90 text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <Trash2 size={14} />
                {deleting ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}