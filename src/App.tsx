import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { supabase } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";
import OnboardingPage from "./pages/OnboardingPage";
import Layout from "./components/Layout";
import ProjectListPage from "./pages/ProjectListPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import AgentEditPage from "./pages/AgentEditPage";
import RunDetailPage from "./pages/RunDetailPage";
import MembersPage from "./pages/MembersPage";
import SettingsPage from "./pages/SettingsPage";
import ApiInstructionsPage from "./pages/ApiInstructionsPage";
import SplashScreen from "./components/SplashScreen";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <AuthPage />;
  return <>{children}</>;
}

function WorkspaceRedirect() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) return;

    supabase
      .from("workspace_members")
      .select("workspace_id, workspaces!inner(id, name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          navigate(
            `/workspace/${(data[0] as any).workspace_id}/projects`,
            { replace: true }
          );
        } else {
          // Check if user created workspaces
          supabase
            .from("workspaces")
            .select("id")
            .eq("created_by", user.id)
            .limit(1)
            .then(({ data: wsData }) => {
              if (wsData && wsData.length > 0) {
                navigate(
                  `/workspace/${wsData[0].id}/projects`,
                  { replace: true }
                );
              } else {
                navigate("/onboard", { replace: true });
              }
              setChecking(false);
            });
        }
        setChecking(false);
      });
  }, [user]);

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return null;
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<AuthGate><WorkspaceRedirect /></AuthGate>} />
          <Route
            path="/onboard"
            element={
              <AuthGate>
                <OnboardingPage />
              </AuthGate>
            }
          />
          <Route
            path="/workspace/:workspaceId"
            element={
              <AuthGate>
                <Layout />
              </AuthGate>
            }
          >
            <Route
              index
              element={<Navigate to="projects" replace />}
            />
            <Route path="projects" element={<ProjectListPage />} />
            <Route
              path="projects/:projectId"
              element={<ProjectDetailPage />}
            />
            <Route
              path="projects/:projectId/agents/:agentId"
              element={<AgentEditPage />}
            />
            <Route
              path="projects/:projectId/agents/:agentId/edit"
              element={<AgentEditPage />}
            />
            <Route
              path="projects/:projectId/runs/:runId"
              element={<RunDetailPage />}
            />
            <Route path="members" element={<MembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="api-instructions" element={<ApiInstructionsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}