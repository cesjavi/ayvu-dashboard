import { useEffect, useState } from "react";
import { Eye, EyeOff, Check, Loader2, Key, Trash2, Plus, Copy, X, Sparkles, Wand2 } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { copyToClipboard } from "../lib/utils";

interface KeyStatus {
  provider: string;
  configured: boolean;
  updatedAt: string | null;
}

interface WorkspaceApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_revoked: boolean;
  last_used_at: string | null;
  created_at: string;
  created_by: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: "Used for GPT-4, GPT-3.5, and other OpenAI models",
  anthropic: "Used for Claude and other Anthropic models",
  groq: "Used for fast inference on Llama, Mixtral, and more",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: "border-l-emerald-500",
  anthropic: "border-l-orange-500",
  groq: "border-l-purple-500",
};

const SUPABASE_URL = "https://qeihnzhmyiinbwqhdqji.supabase.co";

export default function SettingsPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Provider API key state
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>([]);
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
  const [keyMessages, setKeyMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Workspace API key state
  const [workspaceApiKeys, setWorkspaceApiKeys] = useState<WorkspaceApiKey[]>([]);
  const [loadingWorkspaceKeys, setLoadingWorkspaceKeys] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);

  // Client prompt generator state
  const [projects, setProjects] = useState<{ id: string; name: string; description: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [promptLanguage, setPromptLanguage] = useState("TypeScript");
  const [clientPrompt, setClientPrompt] = useState<string | null>(null);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const fetchWorkspaceKeys = async () => {
    if (!workspaceId) return;
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return;

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/list-api-keys?workspaceId=${workspaceId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (data.success && data.keys) {
        setWorkspaceApiKeys(data.keys);
      }
    } catch (err) {
      console.error("Failed to load workspace API keys:", err);
    } finally {
      setLoadingWorkspaceKeys(false);
    }
  };

  // Load key statuses on mount
  useEffect(() => {
    if (!workspaceId || !user) return;

    // Check if user is admin (also check workspace owner)
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()
      .then(({ data }) => {
        setIsAdmin(data?.role === "admin");
      });

    // Fetch key statuses
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) return;

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/get-api-keys?workspaceId=${workspaceId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = await res.json();
        if (data.keys) {
          setKeyStatuses(data.keys);
        }
      } catch (err) {
        console.error("Failed to load key statuses:", err);
      } finally {
        setLoadingStatuses(false);
      }
    })();

    fetchWorkspaceKeys();

    // Fetch projects for the client prompt generator
    supabase
      .from("projects")
      .select("id, name, description")
      .eq("workspace_id", workspaceId)
      .order("name")
      .then(({ data }) => setProjects(data ?? []));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, user]);

  const handleSaveKey = async (provider: string) => {
    const apiKey = keyValues[provider]?.trim();
    if (!apiKey || !workspaceId) return;

    setSavingKey((prev) => ({ ...prev, [provider]: true }));
    setKeyMessages((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) {
      setKeyMessages((prev) => ({
        ...prev,
        [provider]: { type: "error", text: "Not authenticated. Sign out and back in." },
      }));
      setSavingKey((prev) => ({ ...prev, [provider]: false }));
      return;
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/set-api-key`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workspaceId, provider, apiKey }),
        },
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setKeyMessages((prev) => ({
          ...prev,
          [provider]: { type: "success", text: "API key saved successfully" },
        }));
        setKeyStatuses((prev) =>
          prev.map((k) =>
            k.provider === provider
              ? { ...k, configured: true, updatedAt: new Date().toISOString() }
              : k,
          ),
        );
        setKeyValues((prev) => ({ ...prev, [provider]: "" }));
        setTimeout(() => {
          setKeyMessages((prev) => {
            const next = { ...prev };
            if (next[provider]?.type === "success") delete next[provider];
            return next;
          });
        }, 3000);
      } else {
        setKeyMessages((prev) => ({
          ...prev,
          [provider]: { type: "error", text: data.error || "Failed to save key" },
        }));
      }
    } catch {
      setKeyMessages((prev) => ({
        ...prev,
        [provider]: { type: "error", text: "Network error — check your connection" },
      }));
    } finally {
      setSavingKey((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const toggleKeyVisibility = (provider: string) => {
    setVisibleKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleGenerateKey = async () => {
    if (!workspaceId || !newKeyName.trim()) return;
    setGeneratingKey(true);
    setGenerateError(null);
    setGeneratedKey(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) {
      setGenerateError("Not authenticated. Sign out and back in.");
      setGeneratingKey(false);
      return;
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/generate-api-key`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workspaceId, name: newKeyName.trim() }),
        },
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setGeneratedKey(data.key);
        setNewKeyName("");
        await fetchWorkspaceKeys();
      } else {
        setGenerateError(data.error || "Failed to generate key");
      }
    } catch {
      setGenerateError("Network error — check your connection");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!workspaceId) return;
    setRevokingKeyId(keyId);

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) {
      setRevokingKeyId(null);
      return;
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/revoke-api-key`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workspaceId, keyId }),
        },
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setWorkspaceApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      }
    } catch (err) {
      console.error("Failed to revoke key:", err);
    } finally {
      setRevokingKeyId(null);
    }
  };

  const handleCopyKey = async (key: string) => {
    await copyToClipboard(key);
  };

  const indentLines = (text: string, spaces: number): string =>
    text
      .split("\n")
      .map((line) => " ".repeat(spaces) + line)
      .join("\n");

  const handleGenerateClientPrompt = async () => {
    if (!workspaceId || !selectedProjectId) return;
    setGeneratingPrompt(true);
    setPromptError(null);
    setClientPrompt(null);
    setCopiedPrompt(false);

    try {
      const { data: project } = await supabase
        .from("projects")
        .select("id, name, description")
        .eq("id", selectedProjectId)
        .single();

      const { data: agents } = await supabase
        .from("agents")
        .select("id, name, description, provider, model, input_schema, output_schema")
        .eq("project_id", selectedProjectId)
        .order("name");

      if (!project) {
        setPromptError("Project not found. It may have been deleted.");
        setGeneratingPrompt(false);
        return;
      }

      const baseUrl = `${SUPABASE_URL}/functions/v1/external-v1/api/v1`;

      const agentBlocks = (agents ?? [])
        .map((a) => {
          const input = a.input_schema
            ? JSON.stringify(a.input_schema, null, 2)
            : "None (no required parameters)";
          const output = a.output_schema
            ? JSON.stringify(a.output_schema, null, 2)
            : "Free text (no structured output schema)";
          return [
            `### ${a.name}${a.description ? ` — ${a.description}` : ""}`,
            `- Agent ID: ${a.id}`,
            `- Model: ${a.provider} / ${a.model}`,
            `- Input schema:\n${indentLines(input, 2)}`,
            `- Output schema:\n${indentLines(output, 2)}`,
          ].join("\n");
        })
        .join("\n\n");

      const prompt = `You are an expert ${promptLanguage} engineer. Write a complete, production-ready client for the Ayvu AI agent platform so I can trigger and consume AI agent cascade runs from my own application.

## The platform
Ayvu lets users define projects that contain multiple AI agents arranged in a dependency graph (a DAG). When a run is triggered, agents execute in dependency order and their outputs cascade down the graph. The platform exposes a REST API for external applications.

## Project to integrate with
- Name: ${project.name}
- Description: ${project.description ?? "(none)"}
- Project ID: ${project.id}

## API contract
- Base URL: ${baseUrl}
- Authentication: every request must include a workspace API key in the Authorization header as a Bearer token (e.g. \`Authorization: Bearer sk_...\`). Keys are generated in the Ayvu dashboard under Settings → API Keys.
- Query parameters: \`workspaceId\` (the workspace UUID) and \`projectId\` (${project.id}) are required on every request.

### Endpoints
1. \`GET /schema?workspaceId=...&projectId=...\` — Returns a JSON array of all agents in the project with their \`input_schema\` and \`output_schema\`.
2. \`POST /runs\` with JSON body \`{ "workspaceId": "...", "projectId": "...", "parameters": { ... } }\` — Triggers a new run. Returns \`{ "runId": "<uuid>", "status": "queued" }\` immediately.
3. \`GET /runs/<runId>?workspaceId=...&projectId=...\` — Polls for the result. Status goes \`queued → running → completed | failed\`. A completed response includes every agent's output, token usage, and timings.
4. \`GET /agents/<agentId>/instructions?workspaceId=...&projectId=...\` — Returns per-agent usage instructions: input/output schemas, sample cURL commands, and a natural-language explanation of the flow.

## Agents in this project
${agentBlocks}

## Deliverable
Write the client in ${promptLanguage}. It should:
1. Wrap all four endpoints with typed methods (\`getSchema\`, \`createRun\`, \`getRun\`, \`getAgentInstructions\`).
2. Model each agent's input/output schemas as typed structures so callers get type safety when passing parameters and reading results.
3. Support both one-shot triggering and a convenience \`runAndWait\` that polls until the run reaches \`completed\` or \`failed\`.
4. Raise clear, typed errors when the API returns an error code (\`INVALID_API_KEY\`, \`PROJECT_NOT_FOUND\`, \`VALIDATION_ERROR\`, \`RUN_NOT_FOUND\`).
5. Include a short usage example at the end.
6. Avoid external runtime dependencies beyond a standard HTTP client and JSON parsing.

Return the complete source code organized into files. If anything is ambiguous, state your assumptions and proceed with sensible defaults.`;

      setClientPrompt(prompt);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to generate prompt");
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!clientPrompt) return;
    await copyToClipboard(clientPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1500);
  };

  const handleDeleteWorkspace = async () => {
    if (!workspaceId || confirmDelete !== "delete") return;
    setDeletingWorkspace(true);
    setDeleteError(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) {
      setDeleteError("Not authenticated. Sign out and back in.");
      setDeletingWorkspace(false);
      return;
    }

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/delete-workspace`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workspaceId }),
        },
      );
      const data = await res.json();

      if (res.ok && data.success) {
        navigate("/onboard");
      } else {
        setDeleteError(data.error || "Failed to delete workspace");
      }
    } catch {
      setDeleteError("Network error — check your connection");
    } finally {
      setDeletingWorkspace(false);
    }
  };

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setGeneratedKey(null);
    setNewKeyName("");
    setGenerateError(null);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-heading font-semibold text-foreground">
        Workspace settings
      </h1>

      {/* Provider API Keys Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Key size={16} className="text-accent" />
          <h2 className="text-sm font-medium text-foreground">API Keys</h2>
        </div>
        <p className="text-sm text-muted mb-5">
          Configure provider API keys so your agents can run. Keys are stored
          securely and only used by the workspace backend.
        </p>

        {loadingStatuses ? (
          <div className="flex items-center gap-2 text-sm text-muted py-4">
            <Loader2 size={14} className="animate-spin" />
            Loading key statuses…
          </div>
        ) : (
          <div className="space-y-3">
            {keyStatuses.map((ks) => (
              <div
                key={ks.provider}
                className={`bg-surface border border-border border-l-2 ${PROVIDER_COLORS[ks.provider] ?? "border-l-border"} rounded-lg p-4`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {PROVIDER_LABELS[ks.provider] ?? ks.provider}
                    </span>
                    {ks.configured ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <Check size={12} />
                        Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-warning">
                        Not set
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted mb-3">
                  {PROVIDER_DESCRIPTIONS[ks.provider]}
                </p>

                {isAdmin ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type={visibleKeys[ks.provider] ? "text" : "password"}
                          placeholder={
                            ks.configured
                              ? "Enter new key to update…"
                              : "Paste your API key…"
                          }
                          value={keyValues[ks.provider] ?? ""}
                          onChange={(e) =>
                            setKeyValues((prev) => ({
                              ...prev,
                              [ks.provider]: e.target.value,
                            }))
                          }
                          className="w-full bg-elevated border border-border rounded-md px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted/50 font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
                        />
                        <button
                          onClick={() => toggleKeyVisibility(ks.provider)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-all duration-150 cursor-pointer"
                          tabIndex={-1}
                          aria-label={visibleKeys[ks.provider] ? "Hide key" : "Show key"}
                        >
                          {visibleKeys[ks.provider] ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      </div>
                      <button
                        onClick={() => handleSaveKey(ks.provider)}
                        disabled={
                          !keyValues[ks.provider]?.trim() || savingKey[ks.provider]
                        }
                        className="bg-accent hover:bg-accent-hover active:scale-97 text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {savingKey[ks.provider] ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          "Save"
                        )}
                      </button>
                    </div>
                    {keyMessages[ks.provider] && (
                      <p
                        className={`mt-2 text-xs ${
                          keyMessages[ks.provider].type === "success"
                            ? "text-success"
                            : "text-destructive"
                        }`}
                      >
                        {keyMessages[ks.provider].text}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted italic">
                    Only workspace admins can manage API keys.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Workspace API Keys Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-accent" />
            <h2 className="text-sm font-medium text-foreground">Workspace API Keys</h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowGenerateModal(true)}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover active:scale-97 text-white text-sm font-medium rounded-md px-3 py-1.5 transition-all duration-150 cursor-pointer"
            >
              <Plus size={14} />
              Generate New Key
            </button>
          )}
        </div>
        <p className="text-sm text-muted mb-5">
          Use these keys to authenticate requests to the external REST API. Keys are
          shown once when generated.
        </p>

        {loadingWorkspaceKeys ? (
          <div className="flex items-center gap-2 text-sm text-muted py-4">
            <Loader2 size={14} className="animate-spin" />
            Loading workspace API keys…
          </div>
        ) : workspaceApiKeys.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <Key size={24} className="mx-auto text-muted/40 mb-2" />
            <p className="text-sm text-muted">
              {isAdmin
                ? 'No API keys yet. Click "Generate New Key" to create one.'
                : "No API keys to display."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaceApiKeys.map((ak) => (
              <div
                key={ak.id}
                className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground truncate">
                      {ak.name}
                    </span>
                    <span className="text-xs font-mono text-muted">
                      nac_{ak.key_prefix}_...
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span>Created {formatDate(ak.created_at)}</span>
                    <span className="text-muted/40">·</span>
                    <span>Last used {formatDate(ak.last_used_at)}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleRevokeKey(ak.id)}
                    disabled={revokingKeyId === ak.id}
                    className="ml-3 p-1.5 rounded-md text-muted hover:text-destructive hover:bg-destructive/10 transition-all duration-150 disabled:opacity-50 cursor-pointer"
                    aria-label={`Revoke ${ak.name}`}
                  >
                    {revokingKeyId === ak.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Client Prompt Generator Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={16} className="text-accent" />
          <h2 className="text-sm font-medium text-foreground">Client Prompt Generator</h2>
        </div>
        <p className="text-sm text-muted mb-5">
          Generate a ready-to-paste prompt for Claude or ChatGPT that instructs it
          to write a client for one of your projects — including agent schemas,
          endpoints, and authentication details.
        </p>
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="client-project" className="block text-xs font-medium text-muted">
                Project
              </label>
              <select
                id="client-project"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setClientPrompt(null);
                  setPromptError(null);
                }}
                className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="client-language" className="block text-xs font-medium text-muted">
                Language
              </label>
              <select
                id="client-language"
                value={promptLanguage}
                onChange={(e) => setPromptLanguage(e.target.value)}
                className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
              >
                {["TypeScript", "Python", "Go", "Java", "Ruby", "cURL / shell scripts"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={handleGenerateClientPrompt}
            disabled={!selectedProjectId || generatingPrompt}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover active:scale-97 text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {generatingPrompt ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wand2 size={14} />
            )}
            {generatingPrompt ? "Generating…" : "Generate prompt"}
          </button>
          {promptError && (
            <p className="text-xs text-destructive">{promptError}</p>
          )}
          {clientPrompt && (
            <div className="relative animate-fade-in">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-muted uppercase tracking-wider">
                  Copy this prompt and paste it into Claude or ChatGPT
                </p>
                <button
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors duration-150 cursor-pointer"
                >
                  {copiedPrompt ? <Check size={12} /> : <Copy size={12} />}
                  {copiedPrompt ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="bg-elevated border border-border rounded-md p-4 pr-12 font-mono text-xs text-foreground whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto">
                {clientPrompt}
              </pre>
            </div>
          )}
        </div>
      </section>

      {/* Generate Key Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeGenerateModal}
          />
          <div className="relative bg-surface border border-border rounded-xl p-6 max-w-md w-full shadow-xl space-y-4">
            {generatedKey ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Key Generated</h3>
                  <button
                    onClick={closeGenerateModal}
                    className="p-1 rounded-md text-muted hover:text-foreground transition-all duration-150 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                  <p className="text-xs text-warning font-medium mb-1">⚠️ Copy this key now</p>
                  <p className="text-xs text-muted">
                    You won't be able to see it again. If you lose it, generate a new key.
                  </p>
                </div>
                <div className="relative">
                  <pre className="bg-elevated border border-border rounded-md p-3 pr-12 font-mono text-xs text-foreground break-all select-all">
                    {generatedKey}
                  </pre>
                  <button
                    onClick={() => handleCopyKey(generatedKey)}
                    className="absolute top-2 right-2 p-1.5 rounded-md text-muted hover:text-foreground hover:bg-surface transition-all duration-150 cursor-pointer"
                    aria-label="Copy key"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <button
                  onClick={closeGenerateModal}
                  className="w-full bg-accent hover:bg-accent-hover active:scale-97 text-white text-sm font-medium rounded-md py-2 transition-all duration-150 cursor-pointer"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Generate New Key</h3>
                  <button
                    onClick={closeGenerateModal}
                    className="p-1 rounded-md text-muted hover:text-foreground transition-all duration-150 cursor-pointer"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <label
                    htmlFor="key-name"
                    className="block text-xs font-medium text-muted mb-1.5"
                  >
                    Key name
                  </label>
                  <input
                    id="key-name"
                    type="text"
                    placeholder='e.g. "Production", "Staging"'
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKeyName.trim() && !generatingKey) {
                        handleGenerateKey();
                      }
                    }}
                  />
                </div>
                {generateError && (
                  <p className="text-xs text-destructive">{generateError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={closeGenerateModal}
                    className="flex-1 border border-border hover:bg-elevated text-foreground text-sm font-medium rounded-md py-2 transition-all duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateKey}
                    disabled={!newKeyName.trim() || generatingKey}
                    className="flex-1 bg-accent hover:bg-accent-hover active:scale-97 text-white text-sm font-medium rounded-md py-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {generatingKey ? (
                      <Loader2 size={14} className="animate-spin mx-auto" />
                    ) : (
                      "Generate"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={16} className="text-destructive" />
          <h2 className="text-sm font-medium text-foreground">Danger zone</h2>
        </div>
        <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
          <p className="text-sm text-muted">
            Deleting the workspace is permanent and cannot be undone. All
            projects, agents, and runs will be removed.
          </p>

          {isAdmin ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder='Type "delete" to confirm'
                value={confirmDelete}
                onChange={(e) => {
                  setConfirmDelete(e.target.value);
                  setDeleteError(null);
                }}
                className="flex-1 bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-destructive/50 transition-all duration-150"
              />
              <button
                onClick={handleDeleteWorkspace}
                disabled={confirmDelete !== "delete" || deletingWorkspace}
                className="bg-destructive hover:bg-destructive/80 active:scale-97 text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deletingWorkspace ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  "Delete workspace"
                )}
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted italic">
              Only workspace admins can delete the workspace.
            </p>
          )}
          {deleteError && (
            <p className="text-xs text-destructive">{deleteError}</p>
          )}
        </div>
      </section>
    </div>
  );
}