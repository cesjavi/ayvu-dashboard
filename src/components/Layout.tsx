import { useState, useEffect } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  Settings,
  LogOut,
  Users,
  ChevronDown,
  PlayCircle,
  Code2,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";

interface Workspace {
  id: string;
  name: string;
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    supabase
      .from("workspaces")
      .select("id, name")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => {
        if (data) setWorkspace(data);
      });
  }, [workspaceId]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-56 bg-surface border-r border-border flex flex-col shrink-0">
        {/* Workspace header */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
          <img
            src="/logoayvu.png"
            alt="Ayvu"
            className="w-6 h-6 shrink-0"
          />
          <span className="text-sm font-medium text-foreground truncate">
            {workspace?.name ?? "Ayvu"}
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          <Link
            to={`/workspace/${workspaceId}/projects`}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-elevated transition-all duration-150"
          >
            <PlayCircle size={16} />
            Projects
          </Link>
          <Link
            to={`/workspace/${workspaceId}/members`}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-elevated transition-all duration-150"
          >
            <Users size={16} />
            Members
          </Link>
          <Link
            to={`/workspace/${workspaceId}/settings`}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-elevated transition-all duration-150"
          >
            <Settings size={16} />
            Settings
          </Link>
          <Link
            to={`/workspace/${workspaceId}/api-instructions`}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-elevated transition-all duration-150"
          >
            <Code2 size={16} />
            API Instructions
          </Link>
        </nav>

        {/* User menu */}
        <div className="relative border-t border-border p-2">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-elevated transition-all duration-150 cursor-pointer"
          >
            <div className="w-6 h-6 rounded-full bg-elevated flex items-center justify-center text-xs text-muted">
              {user?.email?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <span className="truncate flex-1 text-left">
              {user?.email?.split("@")[0] ?? "User"}
            </span>
            <ChevronDown size={14} />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute bottom-full left-2 right-2 mb-1 bg-elevated border border-border rounded-md shadow-elevated z-20 py-1">
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface transition-all duration-150 cursor-pointer"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}