"use client";

import type { FlowGraph } from "@/lib/phase2/flow/types";
import { layoutFlowGraph, FLOW_LAYOUT_DIMS } from "@/lib/phase2/flow/layout";

const { NODE_W, NODE_H } = FLOW_LAYOUT_DIMS;

interface FlowGraphViewProps {
  graph: FlowGraph;
  /** Route to highlight as the advisory chokepoint (amber). */
  highlightRoute?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export default function FlowGraphView({ graph, highlightRoute }: FlowGraphViewProps) {
  const layout = layoutFlowGraph(graph);

  if (layout.nodes.length === 0) {
    return (
      <p className="text-sm text-[#9B9B9B]">
        No route data available for this window.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-label="User flow route map"
        role="img"
        className="block"
      >
        {/* Edge layer — drawn first so nodes sit on top */}
        {layout.edges.map((edge, i) => (
          <path
            key={i}
            d={edge.path}
            fill="none"
            stroke="rgba(0,0,0,0.10)"
            strokeWidth={edge.weight}
            strokeLinecap="round"
          />
        ))}

        {/* Node layer */}
        {layout.nodes.map((node, i) => {
          const isHighlight = node.route === highlightRoute;
          const exitPct = Math.round(node.exitRate * 100);
          const clipId = `flow-clip-${i}`;

          return (
            <g key={node.route} transform={`translate(${node.x},${node.y})`}>
              <defs>
                <clipPath id={clipId}>
                  <rect width={NODE_W - 16} height={NODE_H} />
                </clipPath>
              </defs>

              {/* Node card */}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={isHighlight ? "#FEF3C7" : "#FFFFFF"}
                stroke={isHighlight ? "#F59E0B" : "rgba(0,0,0,0.08)"}
                strokeWidth={isHighlight ? 1.5 : 1}
              />

              {/* Route label */}
              <text
                x={10}
                y={22}
                fontSize={10}
                fontFamily="'Menlo','Monaco','Courier New',monospace"
                fill={isHighlight ? "#92400E" : "#111111"}
                clipPath={`url(#${clipId})`}
              >
                {truncate(node.route, 26)}
              </text>

              {/* Stats line */}
              <text
                x={10}
                y={40}
                fontSize={9.5}
                fontFamily="system-ui,sans-serif"
                fill={isHighlight ? "#B45309" : "#6B6B6B"}
              >
                {node.sessions.toLocaleString("en-US")} sessions
              </text>
              <text
                x={10}
                y={53}
                fontSize={9.5}
                fontFamily="system-ui,sans-serif"
                fill={isHighlight ? "#D97706" : "#9B9B9B"}
              >
                {exitPct}% exit
                {isHighlight && " ← chokepoint"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
