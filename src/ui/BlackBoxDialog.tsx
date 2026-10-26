import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { MAX_BLACKBOX_PINS, MAX_LABEL_LENGTH } from '../model/circuit';

export interface BlackBoxValues { label: string; inputCount: number; outputCount: number }

/** Create or reconfigure a black box without leaving the circuit editor. */
export function BlackBoxDialog({ initial, existing, submit, cancel }: {
	initial: BlackBoxValues;
	existing: boolean;
	/** Returns an error message to keep the dialog open, or null after a successful save. */
	submit: (values: BlackBoxValues) => string | null;
	cancel: () => void;
}) {
	const [label, setLabel] = useState(initial.label);
	const [inputs, setInputs] = useState(String(initial.inputCount));
	const [outputs, setOutputs] = useState(String(initial.outputCount));
	const [error, setError] = useState<string | null>(null);
	const labelRef = useRef<HTMLInputElement>(null);
	useEffect(() => { labelRef.current?.select(); }, []);
	const whole = (value: string): number | null => {
		const count = Number(value);
		return Number.isInteger(count) && count >= 0 && count <= MAX_BLACKBOX_PINS ? count : null;
	};
	const confirm = (event: SyntheticEvent) => {
		event.preventDefault();
		const inputCount = whole(inputs);
		const outputCount = whole(outputs);
		if (inputCount === null || outputCount === null) {
			setError(`Inputs and outputs must be whole numbers from 0 to ${MAX_BLACKBOX_PINS}.`);
			return;
		}
		if (!label.trim()) { setError('Give the black box a label.'); return; }
		if (label.length > MAX_LABEL_LENGTH) { setError(`The label can be at most ${MAX_LABEL_LENGTH} characters.`); return; }
		const failure = submit({ label, inputCount, outputCount });
		if (failure) setError(failure);
	};
	return <div className="logic-blackbox-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) cancel(); }}>
		<form className="logic-blackbox-dialog" role="dialog" aria-modal="true" aria-label={existing ? 'Configure black box' : 'New black box'} onSubmit={confirm} onKeyDown={event => {
			event.stopPropagation();
			if (event.key === 'Escape') { event.preventDefault(); cancel(); }
		}}>
			<h3>{existing ? 'Configure black box' : 'New black box'}</h3>
			<p className="logic-blackbox-help">A labelled square that stands in for a circuit you use repeatedly.</p>
			<label className="logic-blackbox-field">
				<span>Label</span>
				<input ref={labelRef} type="text" value={label} maxLength={MAX_LABEL_LENGTH} onChange={event => setLabel(event.target.value)} />
			</label>
			<div className="logic-blackbox-counts">
				<label className="logic-blackbox-field">
					<span>Inputs</span>
					<input type="number" inputMode="numeric" min={0} max={MAX_BLACKBOX_PINS} step={1} value={inputs} onChange={event => setInputs(event.target.value)} />
				</label>
				<label className="logic-blackbox-field">
					<span>Outputs</span>
					<input type="number" inputMode="numeric" min={0} max={MAX_BLACKBOX_PINS} step={1} value={outputs} onChange={event => setOutputs(event.target.value)} />
				</label>
			</div>
			<small className="logic-blackbox-help">0–{MAX_BLACKBOX_PINS} pins per side. Existing wires must stay on pins that remain.</small>
			{error && <p className="logic-blackbox-error" role="alert">{error}</p>}
			<div className="logic-blackbox-actions">
				<button type="button" onClick={cancel}>Cancel</button>
				<button type="submit" className="mod-cta">{existing ? 'Save' : 'Place'}</button>
			</div>
		</form>
	</div>;
}
