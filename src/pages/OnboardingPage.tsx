import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setError(null);
    setSubmitting(true);

    const { data: workspace, error: err } = await supabase
      .from("workspaces")
      .insert({ name: workspaceName, created_by: user.id })
      .select()
      .single();

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    // Add the creator as an admin member
    const { error: memberErr } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: workspace.id,
        email: user.email!,
        user_id: user.id,
        role: "admin",
        status: "active",
        invited_by: user.id,
      });

    if (memberErr) {
      setError(memberErr.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    navigate(`/workspace/${workspace.id}/projects`);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Splash branding */}
        <div className="text-center mb-8">
          <img
            src="/logoayvu.png"
            alt="Ayvu"
            className="w-14 h-14 mx-auto mb-3"
          />
          <h1 className="text-2xl font-heading font-semibold text-foreground">
            Welcome to Ayvu
          </h1>
          <p className="text-sm text-muted mt-1">
            Let's set up your workspace
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-lg p-6 space-y-4"
        >
          <div className="space-y-1">
            <label
              htmlFor="workspaceName"
              className="text-sm text-muted font-medium"
            >
              Workspace name
            </label>
            <input
              id="workspaceName"
              type="text"
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
              placeholder="My Team"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !workspaceName.trim()}
            className="w-full bg-accent hover:bg-accent-hover text-white font-medium rounded-md px-4 py-2 text-sm transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}