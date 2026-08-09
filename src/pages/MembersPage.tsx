import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { UserPlus, Mail, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";


interface Member {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function MembersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    loadMembers();
  }, [workspaceId]);

  const loadMembers = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("workspace_members")
      .select("id, email, role, status, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    if (err) console.error(err);
    else setMembers(data ?? []);
    setLoading(false);
  };

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !inviteEmail.trim() || !user) return;

    setError(null);
    const { error: err } = await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      email: inviteEmail.trim(),
      role: "member",
      status: "pending",
      invited_by: user.id,
    });

    if (err) {
      setError(err.message);
      return;
    }

    setInviteEmail("");
    loadMembers();
  };

  const removeMember = async (memberId: string) => {
    const { error: err } = await supabase
      .from("workspace_members")
      .delete()
      .eq("id", memberId);

    if (err) {
      setError(err.message);
      return;
    }
    setMembers(members.filter((m) => m.id !== memberId));
  };

  const isAdmin =
    members.find((m) => m.email === user?.email)?.role === "admin" ||
    members.length === 0;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-heading font-semibold text-foreground">
          Members
        </h1>
        <p className="text-sm text-muted mt-0.5">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Invite form */}
      {isAdmin && (
        <form
          onSubmit={inviteMember}
          className="bg-surface border border-border rounded-lg p-4 mb-6 flex gap-2"
        >
          <div className="flex-1 relative">
            <Mail
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="email"
              placeholder="Invite by email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full bg-elevated border border-border rounded-md pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            />
          </div>
          <button
            type="submit"
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-3 py-2 transition-all duration-150 active:scale-[0.98] cursor-pointer"
          >
            <UserPlus size={16} />
            Invite
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 skeleton" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between bg-surface border border-border rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-xs text-muted shrink-0">
                  {member.email.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {member.email}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted capitalize">
                      {member.role}
                    </span>
                    {member.status === "pending" && (
                      <span className="text-xs text-warning">(pending)</span>
                    )}
                    {member.status === "active" && (
                      <span className="text-xs text-success">active</span>
                    )}
                  </div>
                </div>
              </div>

              {isAdmin && member.email !== user?.email && (
                <button
                  onClick={() => removeMember(member.id)}
                  className="text-muted hover:text-destructive transition-colors duration-150 cursor-pointer p-1"
                  title="Remove member"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}