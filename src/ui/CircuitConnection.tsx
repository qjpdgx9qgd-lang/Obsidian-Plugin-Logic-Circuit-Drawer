import { type ConnectionLineComponentProps, type InternalNode } from '@xyflow/react';
import type { FlowNode } from './CircuitNode';
import { localPinPoint, pathFor, type Point } from './geometry';
import { connectionPreviewPoints } from './junction-connections';

/** Live connections use the same connector endpoints as completed wires. */
export function CircuitConnection({ fromNode, fromHandle, fromX, fromY, toNode, toHandle, toX, toY, connectionLineStyle }: ConnectionLineComponentProps<FlowNode>) {
	const from = connectorPoint(fromNode, fromHandle.id, { x: fromX, y: fromY });
	const to = connectorPoint(toNode, toHandle?.id, { x: toX, y: toY });
	const path = pathFor(connectionPreviewPoints(fromNode.data.model, fromHandle.id ?? '', toNode?.data.model, toHandle?.id, from, to));
	return <path d={path} fill="none" className="react-flow__connection-path" data-circuit-connection-preview="true" vectorEffect="non-scaling-stroke" style={connectionLineStyle} />;
}

function connectorPoint(node: InternalNode<FlowNode> | null, pin: string | null | undefined, fallback: Point): Point {
	if (!node || !pin) return fallback;
	const local = localPinPoint(node.data.model, pin);
	return { x: node.internals.positionAbsolute.x + local.x, y: node.internals.positionAbsolute.y + local.y };
}
