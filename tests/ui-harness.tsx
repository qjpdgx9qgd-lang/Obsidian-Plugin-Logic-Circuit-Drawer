import { createRoot, type Root } from 'react-dom/client';
import { CircuitEditor } from '../src/ui/CircuitEditor';
import { CircuitSession } from '../src/integration/session';
import type { SessionHost } from '../src/integration/session';
import type { NoteStore, BlockBaseline } from '../src/integration/note-store';
import type { CircuitData, GateType } from '../src/model/types';
import { newCircuit, pinsFor, serializeCircuit } from '../src/model/circuit';
import { scanCircuitBlocks, updateCircuitBlock } from '../src/storage/blocks';
import { GRID, localPinPoint } from '../src/ui/geometry';

class BrowserStore {
	text = `Before circuit\n\n\`\`\`logic-circuit\n${serializeCircuit(newCircuit())}\n\`\`\`\n\nAfter circuit`;
	writes = 0;
	private tail: Promise<unknown> = Promise.resolve();
	private blocked: Promise<void> = Promise.resolve();
	private release = () => {};
	holdWrites() { this.blocked = new Promise(resolve => { this.release = resolve; }); }
	releaseWrites() { this.release(); }
	queue<T>(_file: unknown, action: () => Promise<T>): Promise<T> {
		const next = this.tail.catch(() => undefined).then(action);
		this.tail = next;
		return next;
	}
	read(): Promise<string> { return Promise.resolve(this.text); }
	async write(_file: unknown, _editor: unknown, baseline: BlockBaseline, circuit: CircuitData) {
		await this.blocked;
		const result = updateCircuitBlock(this.text, baseline, circuit);
		this.text = result.text;
		this.writes++;
		return Promise.resolve(result.block);
	}
}
const store = new BrowserStore();
let session: CircuitSession;
let root: Root;
const mount = () => {
	const host = { store: store as unknown as NoteStore, file: {}, activate: () => Promise.resolve() } as unknown as SessionHost;
	session = new CircuitSession(host, scanCircuitBlocks(store.text)[0]!);
	root = createRoot(document.getElementById('circuit')!);
	root.render(<CircuitEditor session={session} />);
};
mount();
const show = async (circuit: CircuitData) => {
	await session.finish(); root.unmount(); session.dispose();
	store.text = `Before circuit\n\n\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\`\n\nAfter circuit`;
	mount();
};
const terminalAtPin = (id: string, type: 'input' | 'output', label: string, x: number, y: number) => {
	const pin = localPinPoint({ type, label }, type === 'input' ? 'out' : 'in-1');
	return { id, type, label, position: { x: x - pin.x, y: y - pin.y } };
};
const api = {
	data: () => session.getSnapshot().circuit,
	grid: () => GRID,
	markdown: () => store.text,
	writes: () => store.writes,
	snapshot: () => session.getSnapshot(),
	holdWrites: () => store.holdWrites(),
	releaseWrites: () => store.releaseWrites(),
	rejectCommit: () => { const data = session.getSnapshot().circuit!; session.commit({ ...data, nodes:[...data.nodes, data.nodes[0]!] }); },
	remount: async () => { await session.finish(); root.unmount(); session.dispose(); mount(); },
	showAllGates: async () => {
		const circuit = newCircuit();
		const gates: GateType[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'];
		gates.forEach((type, index) => {
			const y = index * 128;
			circuit.nodes.push({ id: type, type, position: { x: 208, y } },
				terminalAtPin(`${type}-output`, 'output', 'Y', 448, y + 32));
			circuit.edges.push({ id: `${type}-out`, sourceNodeId: type, sourcePinId: 'out', targetNodeId: `${type}-output`, targetPinId: 'in-1' });
			pinsFor(type).inputs.forEach((pin, inputIndex) => {
				const id = `${type}-${pin}`;
				const pinY = type === 'not' ? 32 : inputIndex ? 48 : 16;
				circuit.nodes.push(terminalAtPin(id, 'input', inputIndex ? 'B' : 'A', 80, y + pinY));
				circuit.edges.push({ id: `${id}-wire`, sourceNodeId: id, sourcePinId: 'out', targetNodeId: type, targetPinId: pin });
			});
		});
		await show(circuit);
	},
	showHeightFixture: () => {
		const circuit = newCircuit();
		circuit.nodes = [
			// Existing circuits may contain positions from the previous grid.
			{ id: 'height-anchor', type: 'and', position: { x: 65, y: 3 } },
			{ id: 'height-moving', type: 'or', position: { x: 384, y: 0 } },
		];
		return show(circuit);
	},
	showCardinalJunction: () => {
		const circuit = newCircuit();
		circuit.nodes = [
			terminalAtPin('junction-input', 'input', 'A', 80, 256),
			{ id: 'cardinal-junction', type: 'junction', position: { x: 248, y: 248 } },
			terminalAtPin('junction-right', 'output', 'Right', 448, 256),
			terminalAtPin('junction-top', 'output', 'Top', 256, 112),
			terminalAtPin('junction-bottom', 'output', 'Bottom', 256, 400),
		];
		circuit.edges = [
			{ id: 'junction-left-wire', sourceNodeId: 'junction-input', sourcePinId: 'out', targetNodeId: 'cardinal-junction', targetPinId: 'in-1' },
			...['right', 'top', 'bottom'].map(side => ({ id: `junction-${side}-wire`, sourceNodeId: 'cardinal-junction', sourcePinId: 'out', targetNodeId: `junction-${side}`, targetPinId: 'in-1' })),
		];
		return show(circuit);
	},
	showMyTestCircuit: () => {
		const circuit = newCircuit();
		circuit.nodes = [
			{ id:'mytest-a', type:'input', label:'A', position:{ x:72, y:40 } },
			{ id:'mytest-nand', type:'nand', position:{ x:416, y:296 } },
			{ id:'mytest-xor', type:'xor', position:{ x:536, y:128 } },
			{ id:'mytest-junction', type:'junction', position:{ x:260, y:176 } },
		];
		circuit.edges = [
			{ id:'mytest-a-nand', sourceNodeId:'mytest-a', sourcePinId:'out', targetNodeId:'mytest-nand', targetPinId:'in-1' },
			{ id:'mytest-a-xor', sourceNodeId:'mytest-a', sourcePinId:'out', targetNodeId:'mytest-xor', targetPinId:'in-1' },
			{ id:'mytest-a-junction', sourceNodeId:'mytest-a', sourcePinId:'out', targetNodeId:'mytest-junction', targetPinId:'in-1' },
			{ id:'mytest-junction-nand', sourceNodeId:'mytest-junction', sourcePinId:'out', targetNodeId:'mytest-nand', targetPinId:'in-2' },
			{ id:'mytest-junction-xor', sourceNodeId:'mytest-junction', sourcePinId:'out', targetNodeId:'mytest-xor', targetPinId:'in-2' },
		];
		return show(circuit);
	},
	showBlackBoxFixture: () => {
		const circuit = newCircuit();
		circuit.nodes = [
			terminalAtPin('bb-a', 'input', 'A', 72, 112),
			{ id: 'bb-fa', type: 'blackbox', label: 'FA', inputCount: 3, outputCount: 2, position: { x: 208, y: 64 } },
			terminalAtPin('bb-sum', 'output', 'Sum', 480, 112),
		];
		circuit.edges = [
			{ id: 'bb-a-fa', sourceNodeId: 'bb-a', sourcePinId: 'out', targetNodeId: 'bb-fa', targetPinId: 'in-1' },
			{ id: 'bb-fa-sum', sourceNodeId: 'bb-fa', sourcePinId: 'out-1', targetNodeId: 'bb-sum', targetPinId: 'in-1' },
		];
		return show(circuit);
	},
	showFeedbackFixture: () => {
		const circuit = newCircuit();
		circuit.nodes = [
			{ id:'feedback-input', type:'input', label:'A', position:{ x:32, y:0 } },
			{ id:'feedback-and', type:'and', position:{ x:208, y:64 } },
		];
		return show(circuit);
	},
	conflict: () => {
		const block = scanCircuitBlocks(store.text)[0]!;
		const circuit = JSON.parse(block.content) as CircuitData;
		store.text = updateCircuitBlock(store.text, { circuitId: circuit.circuitId, content: block.content },
			{ ...circuit, view: { preferredScale: circuit.view.preferredScale === 2 ? 1 : 2 } }).text;
	},
};
declare global { interface Window { circuitTest: typeof api; } }
window.circuitTest = api;
