import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus, FolderKanban, Copy, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate, copyToClipboard } from "../lib/utils";

interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export default function ProjectListPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    supabase
      .from("projects")
      .select("id, name, description, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) console.error(err);
        else setProjects(data ?? []);
        setLoading(false);
      });
  }, [workspaceId]);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !newName.trim()) return;

    const { data, error: err } = await supabase
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: newName.trim(),
        description: newDesc.trim(),
      })
      .select()
      .single();

    if (err) {
      setError(err.message);
      return;
    }

    setProjects([data!, ...projects]);
    setNewName("");
    setNewDesc("");
    setShowNew(false);
    setError(null);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-heading font-semibold text-foreground">
            Projects
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-3 py-2 transition-all duration-150 active:scale-[0.98] cursor-pointer"
        >
          <Plus size={16} />
          New project
        </button>
      </div>

      {/* New project form */}
      {showNew && (
        <form
          onSubmit={createProject}
          className="bg-surface border border-border rounded-lg p-4 mb-6 space-y-3 animate-fade-in"
        >
          <input
            type="text"
            placeholder="Project name"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
          />
          <textarea
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={2}
            className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150 resize-none"
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-3 py-1.5 transition-all duration-150 active:scale-[0.98] cursor-pointer"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="text-sm text-muted hover:text-foreground px-3 py-1.5 transition-colors duration-150 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Project list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 skeleton" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16">
          <FolderKanban size={48} className="mx-auto text-muted/30 mb-3" />
          <p className="text-muted text-sm">No projects yet</p>
          <p className="text-muted/50 text-xs mt-1">
            Create your first project to start building agent workflows
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/workspace/${workspaceId}/projects/${project.id}`}
              className="block bg-surface border border-border rounded-lg p-4 hover:bg-elevated transition-all duration-150 group"
            >
              <h3 className="text-sm font-medium text-foreground group-hover:text-accent transition-colors duration-150">
                {project.name}
              </h3>
              {project.description && (
                <p className="text-xs text-muted mt-0.5 line-clamp-1">
                  {project.description}
                </p>
              )}
              <p className="text-xs text-muted/50 mt-1.5">
                Created {formatDate(project.created_at)}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-muted/30 font-mono">
                  ID: {project.id}
                </p>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await copyToClipboard(project.id);
                    setCopiedId(project.id);
                    setTimeout(() => setCopiedId(null), 1500);
                  }}
                  className="text-muted/40 hover:text-accent transition-colors duration-150 cursor-pointer"
                  title="Copy project ID"
                >
                  {copiedId === project.id ? (
                    <Check size={12} className="text-accent" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}