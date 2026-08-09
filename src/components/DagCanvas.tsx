import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  NodeProps,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DagAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
}

export interface DagDependency {
  agent_id: string;
  depends_on_agent_id: string;
}

export type AgentStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface DagCanvasProps {
  agents: DagAgent[];
  dependencies: DagDependency[];
  /** agentId → status map – pass from a run */
  agentStatuses?: Record<string, AgentStatus>;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Layout helper — layered topological sort                           */
/* ------------------------------------------------------------------ */

const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;
const H_GAP = 60;
const V_GAP = 80;

function computePositions(
  agents: DagAgent[],
  dependencies: DagDependency[],
): Map<string, { x: number; y: number }> {
  const agentIds = new Set(agents.map((a) => a.id));

  const childrenOf = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const a of agents) {
    childrenOf.set(a.id, []);
    inDegree.set(a.id, 0);
  }

  for (const dep of dependencies) {
    const child = dep.agent_id;
    const parent = dep.depends_on_agent_id;
    if (agentIds.has(child) && agentIds.has(parent)) {
      childrenOf.get(parent)?.push(child);
      inDegree.set(child, (inDegree.get(child) ?? 0) + 1);
    }
  }

  // Topological sort → layer assignment (0 = no dependencies)
  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      layerOf.set(id, 0);
    }
  }

  while (queue.length) {
    const node = queue.shift()!;
    const layer = layerOf.get(node) ?? 0;
    for (const child of childrenOf.get(node) ?? []) {
      layerOf.set(child, Math.max(layerOf.get(child) ?? 0, layer + 1));
      inDegree.set(child, (inDegree.get(child) ?? 1) - 1);
      if ((inDegree.get(child) ?? 0) <= 0) queue.push(child);
    }
  }

  // Isolated agents (no deps, no dependents) still need a layer
  for (const a of agents) {
    if (!layerOf.has(a.id)) layerOf.set(a.id, 0);
  }

  // Group by layer
  const layers = new Map<number, string[]>();
  for (const [id, l] of layerOf) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [layer, ids] of layers) {
    const totalWidth = ids.length * NODE_WIDTH + (ids.length - 1) * H_GAP;
    const startX = -totalWidth / 2 + NODE_WIDTH / 2;
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], {
        x: startX + i * (NODE_WIDTH + H_GAP),
        y: layer * (NODE_HEIGHT + V_GAP),
      });
    }
  }

  return positions;
}

/* ------------------------------------------------------------------ */
/*  Custom node component                                              */
/* ------------------------------------------------------------------ */

type AgentNodeData = {
  label: string;
  subtitle: string;
  status: AgentStatus;
};

type AgentNodeElement = Node<AgentNodeData, "agent">;

function AgentNode({ data, selected }: NodeProps<AgentNodeElement>) {
  const status = data.status ?? "idle";

  const statusBorder = {
    idle: "border-border",
    queued: "border-warning",
    running: "border-accent",
    completed: "border-success",
    failed: "border-destructive",
    skipped: "border-border",
  }[status];

  const statusText = {
    idle: "text-muted",
    queued: "text-warning",
    running: "text-accent",
    completed: "text-success",
    failed: "text-destructive",
    skipped: "text-muted",
  }[status];

  const statusBg = {
    idle: "bg-surface",
    queued: "bg-surface",
    running: "bg-surface",
    completed: "bg-surface",
    failed: "bg-surface",
    skipped: "bg-surface/60",
  }[status];

  const runningGlow =
    status === "running"
      ? "shadow-[0_0_14px_oklch(0.62_0.19_250/0.35)]"
      : "";

  const dotColor =
    status === "idle"
      ? "bg-border"
      : status === "queued"
        ? "bg-warning"
        : status === "running"
          ? "bg-accent animate-pulse"
          : status === "completed"
            ? "bg-success"
            : status === "failed"
              ? "bg-destructive"
              : "bg-border";

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-border !w-2 !h-2 !border-2 !border-background"
      />
      <div
        className={`
          ${statusBg} ${statusBorder} ${runningGlow}
          border-2 rounded-lg px-3 py-2.5
          min-w-[160px] max-w-[200px]
          transition-all duration-300
          ${selected ? "ring-2 ring-accent/60" : ""}
        `}
      >
        <p
          className="text-xs font-medium text-foreground truncate leading-tight"
          title={data.label}
        >
          {data.label}
        </p>
        <p className={`text-[10px] ${statusText} mt-0.5 truncate`}>
          {data.subtitle}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className={`text-[10px] capitalize ${statusText}`}>
            {status === "idle" ? "ready" : status}
          </span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-border !w-2 !h-2 !border-2 !border-background"
      />
    </>
  );
}

const nodeTypes = { agent: AgentNode };

/* ------------------------------------------------------------------ */
/*  Main canvas component                                              */
/* ------------------------------------------------------------------ */

export default function DagCanvas({
  agents,
  dependencies,
  agentStatuses = {},
  className = "",
}: DagCanvasProps) {
  const positions = useMemo(
    () => computePositions(agents, dependencies),
    [agents, dependencies],
  );

  const nodes: Node<AgentNodeData, "agent">[] = useMemo(() => {
    const statusMap = agentStatuses;
    return agents.map((a) => ({
      id: a.id,
      type: "agent" as const,
      position: positions.get(a.id) ?? { x: 0, y: 0 },
      data: {
        label: a.name,
        subtitle: `${a.provider} · ${a.model}`,
        status: statusMap[a.id] ?? "idle",
      },
    }));
  }, [agents, positions, agentStatuses]);

  const edges: Edge[] = useMemo(() => {
    const agentIds = new Set(agents.map((a) => a.id));
    const seen = new Set<string>();
    const result: Edge[] = [];

    for (const dep of dependencies) {
      const key = `${dep.depends_on_agent_id}→${dep.agent_id}`;
      if (seen.has(key)) continue;
      if (!agentIds.has(dep.agent_id) || !agentIds.has(dep.depends_on_agent_id))
        continue;
      seen.add(key);
      result.push({
        id: `e-${key}`,
        source: dep.depends_on_agent_id,
        target: dep.agent_id,
      });
    }
    return result;
  }, [agents, dependencies]);

  const defaultEdgeOptions = useMemo(
    () => ({
      type: "smoothstep" as const,
      style: { stroke: "oklch(0.4 0.02 260)", strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "oklch(0.4 0.02 260)",
        width: 16,
        height: 16,
      },
    }),
    [],
  );

  const minimapColor = useCallback((node: Node) => {
    const d = (node.data as AgentNodeData) ?? null;
    if (!d || d.status === "idle" || d.status === "skipped")
      return "oklch(0.3 0.02 260)";
    if (d.status === "running") return "oklch(0.62 0.19 250)";
    if (d.status === "completed") return "oklch(0.6 0.18 145)";
    if (d.status === "failed") return "oklch(0.58 0.22 30)";
    if (d.status === "queued") return "oklch(0.7 0.18 85)";
    return "oklch(0.3 0.02 260)";
  }, []);

  return (
    <div className={`w-full h-full min-h-[300px] ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        nodesFocusable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-background/50 rounded-lg"
      >
        <Controls
          showInteractive={false}
          className="!bg-surface !border-border [&>button]:!text-muted [&>button]:!border-border [&>button]:hover:!bg-elevated [&>button]:cursor-pointer"
        />
        <MiniMap
          nodeStrokeWidth={2}
          nodeColor={minimapColor}
          maskColor="oklch(0.13 0.01 260/0.7)"
          className="!bg-surface !border-border !rounded-md"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="oklch(0.25 0.015 260)"
        />
      </ReactFlow>
    </div>
  );
}