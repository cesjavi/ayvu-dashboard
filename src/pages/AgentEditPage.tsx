import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, Save, Info, Plus, Check, Trash2, SlidersHorizontal,
  FileJson, Code,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface AgentForm {
  name: string;
  description: string;
  system_prompt: string;
  provider: "openai" | "anthropic" | "groq";
  model: string;
  temperature: number;
  max_tokens: number;
}

interface PeerAgent {
  id: string;
  name: string;
}

interface InputSchemaParam {
  key: string;
  type: "string" | "number" | "boolean" | "integer";
  description: string;
  required: boolean;
  enumValues: string;
}

function buildJsonSchema(params: InputSchemaParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type };
    if (p.description.trim()) prop.description = p.description.trim();
    if (p.enumValues.trim()) {
      const raw = p.enumValues.split(",").map((s) => s.trim()).filter(Boolean);
      if (p.type === "number" || p.type === "integer") {
        prop.enum = raw.map(Number).filter((n) => !isNaN(n));
      } else {
        prop.enum = raw;
      }
    }
    properties[p.key] = prop;
    if (p.required) required.push(p.key);
  }

  const schema: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

function parseJsonSchemaToParams(schema: Record<string, unknown> | null): InputSchemaParam[] {
  if (!schema?.properties || typeof schema.properties !== "object") return [];
  const props = schema.properties as Record<string, unknown>;
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];

  return Object.entries(props).map(([key, prop]) => {
    const p = prop as Record<string, unknown>;
    return {
      key,
      type: (p.type as "string" | "number" | "boolean" | "integer") ?? "string",
      description: (p.description as string) ?? "",
      required: required.includes(key),
      enumValues: Array.isArray(p.enum) ? (p.enum as unknown[]).join(", ") : "",
    };
  });
}

export default function AgentEditPage() {
  const { workspaceId, projectId, agentId } = useParams<{
    workspaceId: string;
    projectId: string;
    agentId: string;
  }>();
  const navigate = useNavigate();
  const isNew = agentId === "new";

  const [form, setForm] = useState<AgentForm>({
    name: "",
    description: "",
    system_prompt: "",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    temperature: 0.7,
    max_tokens: 1024,
  });
  const [peerAgents, setPeerAgents] = useState<PeerAgent[]>([]);
  const [existingDeps, setExistingDeps] = useState<[string, string][]>([]);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cycleError, setCycleError] = useState<string | null>(null);

  // Input schema (replaces project_params)
  const [inputParams, setInputParams] = useState<InputSchemaParam[]>([]);
  const [showAddInputParam, setShowAddInputParam] = useState(false);
  const [inputParamError, setInputParamError] = useState<string | null>(null);
  const [newInputParam, setNewInputParam] = useState<InputSchemaParam>({
    key: "",
    type: "string",
    description: "",
    required: true,
    enumValues: "",
  });

  // Output schema
  const [outputSchemaJson, setOutputSchemaJson] = useState<string>("");
  const [outputSchemaError, setOutputSchemaError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    supabase
      .from("agents")
      .select("id, name")
      .eq("project_id", projectId)
      .order("name")
      .then(({ data }) => {
        setPeerAgents(
          (data ?? []).filter((a) => a.id !== agentId)
        );
      });

    supabase
      .from("agent_dependencies")
      .select("agent_id, depends_on_agent_id")
      .then(({ data }) => {
        if (data) {
          setExistingDeps(
            data.map((d) => [d.agent_id, d.depends_on_agent_id] as [string, string])
          );
        }
      });

    if (agentId && agentId !== "new") {
      supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single()
        .then(({ data }) => {
          if (data) {
            setForm({
              name: data.name,
              description: data.description ?? "",
              system_prompt: data.system_prompt ?? "",
              provider: data.provider,
              model: data.model,
              temperature: data.temperature,
              max_tokens: data.max_tokens,
            });

            // Load input_schema
            const inputSchema = data.input_schema as Record<string, unknown> | null;
            setInputParams(parseJsonSchemaToParams(inputSchema));

            // Load output_schema
            const outputSchema = data.output_schema as Record<string, unknown> | null;
            setOutputSchemaJson(
              outputSchema ? JSON.stringify(outputSchema, null, 2) : ""
            );
          }
        });

      supabase
        .from("agent_dependencies")
        .select("depends_on_agent_id")
        .eq("agent_id", agentId)
        .then(({ data }) => {
          if (data) {
            setDependencies(data.map((d) => d.depends_on_agent_id));
          }
        });
    }
  }, [projectId, agentId]);

  const wouldCreateCycle = (
    fromId: string,
    toId: string,
    currentDeps: string[]
  ): boolean => {
    const edges = new Map<string, Set<string>>();
    for (const [a_id, dep_id] of existingDeps) {
      if (a_id === agentId || a_id === fromId) continue;
      if (!edges.has(a_id)) edges.set(a_id, new Set());
      edges.get(a_id)!.add(dep_id);
    }
    for (const depId of currentDeps) {
      if (!edges.has(fromId)) edges.set(fromId, new Set());
      edges.get(fromId)!.add(depId);
    }
    if (!edges.has(fromId)) edges.set(fromId, new Set());
    edges.get(fromId)!.add(toId);

    const visited = new Set<string>();
    const queue = [toId];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node === fromId) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      const neighbors = edges.get(node);
      if (neighbors) {
        for (const n of neighbors) queue.push(n);
      }
    }
    return false;
  };

  const toggleDependency = (depId: string) => {
    setCycleError(null);
    if (dependencies.includes(depId)) {
      setDependencies(dependencies.filter((d) => d !== depId));
    } else if (agentId) {
      if (wouldCreateCycle(agentId, depId, dependencies)) {
        setCycleError(
          "Adding this dependency would create a cycle in the graph"
        );
        return;
      }
      setDependencies([...dependencies, depId]);
    } else {
      setDependencies([...dependencies, depId]);
    }
  };

  const addInputParam = () => {
    if (!newInputParam.key.trim()) {
      setInputParamError("Parameter key is required");
      return;
    }

    const key = newInputParam.key.trim().toLowerCase().replace(/\s+/g, "_");
    if (!/^[a-z0-9_]+$/.test(key)) {
      setInputParamError("Key can only contain lowercase letters, numbers, and underscores");
      return;
    }

    if (inputParams.some((p) => p.key === key)) {
      setInputParamError("A parameter with this key already exists");
      return;
    }

    setInputParams((prev) => [...prev, { ...newInputParam, key }]);
    setNewInputParam({
      key: "",
      type: "string",
      description: "",
      required: true,
      enumValues: "",
    });
    setShowAddInputParam(false);
    setInputParamError(null);
  };

  const deleteInputParam = (key: string) => {
    setInputParams((prev) => prev.filter((p) => p.key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !workspaceId) return;

    // Validate output schema JSON if provided
    let parsedOutputSchema: Record<string, unknown> | null = null;
    if (outputSchemaJson.trim()) {
      try {
        parsedOutputSchema = JSON.parse(outputSchemaJson.trim());
        if (typeof parsedOutputSchema !== "object" || parsedOutputSchema === null || Array.isArray(parsedOutputSchema)) {
          setOutputSchemaError("Output schema must be a JSON object");
          return;
        }
      } catch {
        setOutputSchemaError("Invalid JSON in output schema");
        return;
      }
    }
    setOutputSchemaError(null);

    const inputSchema = buildJsonSchema(inputParams);

    setSaving(true);
    setError(null);

    if (isNew) {
      const { data: agent, error: err } = await supabase
        .from("agents")
        .insert({
          project_id: projectId,
          ...form,
          input_schema: inputSchema,
          output_schema: parsedOutputSchema,
        })
        .select()
        .single();

      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }

      if (dependencies.length > 0) {
        await supabase.from("agent_dependencies").insert(
          dependencies.map((depId) => ({
            agent_id: agent!.id,
            depends_on_agent_id: depId,
          }))
        );
      }

      setSaving(false);
      navigate(
        `/workspace/${workspaceId}/projects/${projectId}`
      );
    } else if (agentId) {
      const { error: err } = await supabase
        .from("agents")
        .update({
          ...form,
          input_schema: inputSchema,
          output_schema: parsedOutputSchema,
        })
        .eq("id", agentId);

      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }

      await supabase
        .from("agent_dependencies")
        .delete()
        .eq("agent_id", agentId);

      if (dependencies.length > 0) {
        await supabase.from("agent_dependencies").insert(
          dependencies.map((depId) => ({
            agent_id: agentId,
            depends_on_agent_id: depId,
          }))
        );
      }

      setSaving(false);
      navigate(
        `/workspace/${workspaceId}/projects/${projectId}`
      );
    }
  };

  const providerModels: Record<string, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
    anthropic: [
      "claude-3-5-sonnet-latest",
      "claude-3-opus-latest",
      "claude-3-haiku-20240307",
    ],
    groq: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link
        to={`/workspace/${workspaceId}/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors duration-150 mb-4 cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to project
      </Link>

      <h1 className="text-xl font-heading font-semibold text-foreground mb-6">
        {isNew ? "New agent" : "Edit agent"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name */}
        <div className="space-y-1">
          <label className="text-sm text-muted font-medium">Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            placeholder="Research agent"
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-sm text-muted font-medium">
            Description
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            placeholder="What this agent does"
          />
        </div>

        {/* System prompt */}
        <div className="space-y-1">
          <label className="text-sm text-muted font-medium">
            System prompt
          </label>
          <textarea
            required
            rows={4}
            value={form.system_prompt}
            onChange={(e) =>
              setForm({ ...form, system_prompt: e.target.value })
            }
            className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150 resize-none font-mono"
            placeholder="You are a research assistant that..."
          />
        </div>

        {/* Provider + Model */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm text-muted font-medium">
              Provider
            </label>
            <select
              value={form.provider}
              onChange={(e) => {
                const provider = e.target.value as "openai" | "anthropic" | "groq";
                const models = providerModels[provider];
                setForm({
                  ...form,
                  provider,
                  model: models[0],
                });
              }}
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="groq">Groq</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-muted font-medium">Model</label>
            <select
              value={form.model}
              onChange={(e) =>
                setForm({ ...form, model: e.target.value })
              }
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            >
              {providerModels[form.provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Temperature + Max tokens */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm text-muted font-medium">
              Temperature
            </label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) =>
                setForm({
                  ...form,
                  temperature: parseFloat(e.target.value),
                })
              }
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted font-medium">
              Max tokens
            </label>
            <input
              type="number"
              min={1}
              max={128000}
              step={1}
              value={form.max_tokens}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_tokens: parseInt(e.target.value),
                })
              }
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150"
            />
          </div>
        </div>

        {/* Dependencies */}
        {peerAgents.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm text-muted font-medium">
              Dependencies
            </label>
            <p className="text-xs text-muted/70">
              This agent will receive the outputs of its dependencies as
              context
            </p>
            <div className="bg-elevated border border-border rounded-md p-3 space-y-1">
              {peerAgents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface transition-colors duration-150 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={dependencies.includes(agent.id)}
                    onChange={() => toggleDependency(agent.id)}
                    className="rounded border-border bg-elevated text-accent focus:ring-accent/50"
                  />
                  <span className="text-sm text-foreground">
                    {agent.name}
                  </span>
                </label>
              ))}
            </div>
            {cycleError && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <Info size={12} />
                {cycleError}
              </p>
            )}
          </div>
        )}

        {/* ─── Input Schema (JSON Schema) ─── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted font-medium">
              Input Schema (JSON Schema)
            </label>
            <button
              type="button"
              onClick={() => {
                setShowAddInputParam(!showAddInputParam);
                setInputParamError(null);
              }}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors duration-150 cursor-pointer"
            >
              <Plus size={13} />
              Add parameter
            </button>
          </div>
          <p className="text-xs text-muted/70">
            Define typed parameters this agent accepts. External API callers
            will see this schema. Each parameter becomes a JSON Schema property.
          </p>

          {showAddInputParam && (
            <div className="bg-surface border border-border rounded-md p-3 space-y-2 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Key <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={newInputParam.key}
                    onChange={(e) =>
                      setNewInputParam((p) => ({ ...p, key: e.target.value }))
                    }
                    placeholder="e.g. topic"
                    className="w-full bg-elevated border border-border text-sm text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-muted/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Type
                  </label>
                  <select
                    value={newInputParam.type}
                    onChange={(e) =>
                      setNewInputParam((p) => ({
                        ...p,
                        type: e.target.value as "string" | "number" | "boolean" | "integer",
                      }))
                    }
                    className="w-full bg-elevated border border-border text-sm text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="integer">integer</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Description
                </label>
                <input
                  type="text"
                  value={newInputParam.description}
                  onChange={(e) =>
                    setNewInputParam((p) => ({ ...p, description: e.target.value }))
                  }
                  placeholder="What this parameter controls"
                  className="w-full bg-elevated border border-border text-sm text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-muted/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Enum values (comma-separated, optional)
                </label>
                <input
                  type="text"
                  value={newInputParam.enumValues}
                  onChange={(e) =>
                    setNewInputParam((p) => ({ ...p, enumValues: e.target.value }))
                  }
                  placeholder="option_a, option_b, option_c"
                  className="w-full bg-elevated border border-border text-sm text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-muted/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newInputParam.required}
                    onChange={(e) =>
                      setNewInputParam((p) => ({ ...p, required: e.target.checked }))
                    }
                    className="rounded border-border bg-elevated accent-accent"
                  />
                  Required
                </label>
              </div>
              {inputParamError && (
                <p className="text-xs text-destructive">{inputParamError}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={addInputParam}
                  className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-md px-3 py-1.5 transition-all duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <Check size={12} />
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddInputParam(false);
                    setInputParamError(null);
                  }}
                  className="text-xs text-muted hover:text-foreground transition-colors duration-150 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {inputParams.length === 0 ? (
            <div className="bg-elevated border border-border rounded-md px-3 py-2.5 text-xs text-muted">
              <SlidersHorizontal size={12} className="inline mr-1" />
              No input parameters defined. Add parameters to define what
              values this agent expects when it runs.
            </div>
          ) : (
            <div className="bg-elevated border border-border rounded-md divide-y divide-border">
              {inputParams.map((p) => (
                <div
                  key={p.key}
                  className="px-3 py-2 flex items-center justify-between group"
                >
                  <div>
                    <span className="text-sm text-foreground font-mono">
                      {p.key}
                    </span>
                    {p.required && (
                      <span className="text-xs text-destructive ml-1">*</span>
                    )}
                    <span className="text-xs text-muted ml-2">
                      {p.type}
                    </span>
                    {p.description && (
                      <p className="text-xs text-muted mt-0.5">
                        {p.description}
                      </p>
                    )}
                    {p.enumValues && (
                      <p className="text-xs text-muted/60 mt-0.5">
                        enum: [{p.enumValues}]
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteInputParam(p.key)}
                    className="text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-pointer"
                    aria-label={`Delete parameter ${p.key}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── Output Schema (JSON Schema) ─── */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileJson size={14} className="text-muted" />
            <label className="text-sm text-muted font-medium">
              Output Schema (JSON Schema)
            </label>
          </div>
          <p className="text-xs text-muted/70">
            Define a structured output schema. When set, the LLM will be
            forced to respond via tool-calling with valid JSON matching this
            schema. Leave empty for free-text output.
          </p>
          <div className="relative">
            <textarea
              rows={5}
              value={outputSchemaJson}
              onChange={(e) => {
                setOutputSchemaJson(e.target.value);
                setOutputSchemaError(null);
              }}
              placeholder={`{\n  "type": "object",\n  "properties": {\n    "summary": { "type": "string" },\n    "confidence": { "type": "number" }\n  },\n  "required": ["summary"]\n}`}
              className="w-full bg-elevated border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all duration-150 resize-none font-mono"
            />
          </div>
          {outputSchemaError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <Info size={12} />
              {outputSchemaError}
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md px-4 py-2 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Save size={16} />
          {saving ? "Saving\u2026" : isNew ? "Create agent" : "Save changes"}
        </button>
      </form>
    </div>
  );
}