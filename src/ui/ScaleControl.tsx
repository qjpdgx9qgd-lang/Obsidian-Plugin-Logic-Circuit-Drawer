import { useEffect, useId, useRef, useState } from 'react';
import { MIN_SCALE, MAX_SCALE } from '../model/circuit';
import { useAccessibleLabel } from './accessibility';

const percentage = (scale: number): string => String(Math.round(scale * 1000) / 10);

export function ScaleControl({ scale, maximum, disabled, commit }: {
	scale: number;
	maximum: number;
	disabled: boolean;
	commit: (scale: number) => void;
}) {
	const [draft, setDraft] = useState(() => percentage(scale));
	const [invalid, setInvalid] = useState(false);
	const [rejection, setRejection] = useState(0);
	const field = useRef<HTMLInputElement>(null);
	const validationId = useId();
	const name = useAccessibleLabel('Circuit scale percentage');
	const focused = useRef(false);
	const completed = useRef(false);
	const changed = useRef(false);
	useEffect(() => {
		if (!focused.current) { setDraft(percentage(scale)); setInvalid(false); }
	}, [scale]);
	useEffect(() => {
		const ownerWindow = field.current?.ownerDocument.defaultView;
		if (!invalid || !ownerWindow) return;
		const timer = ownerWindow.setTimeout(() => {
			setInvalid(false);
			if (!focused.current) { setDraft(percentage(scale)); changed.current = false; }
		}, 4000);
		return () => ownerWindow.clearTimeout(timer);
	}, [invalid, rejection, scale]);
	const restore = () => { setDraft(percentage(scale)); setInvalid(false); changed.current = false; };
	const confirm = (): boolean => {
		if (completed.current || !changed.current) return true;
		const value = draft.trim().replace(/%$/, '').trim();
		const number = Number(value);
		if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(number)
			|| number < MIN_SCALE * 100 || number > MAX_SCALE * 100) {
			setInvalid(true);
			setRejection(value => value + 1);
			return false;
		}
		const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, maximum, number / 100));
		completed.current = true;
		changed.current = false;
		setInvalid(false);
		setDraft(percentage(Math.min(next, maximum)));
		commit(next);
		return true;
	};
	return <label className={`logic-scale-value${invalid ? ' is-invalid' : ''}`}>
		{name.label}
		<input ref={field} className="logic-scale-input" type="text" inputMode="decimal" aria-labelledby={name.id}
			aria-invalid={invalid} aria-describedby={invalid ? validationId : undefined}
			title="Scale" value={draft} disabled={disabled}
			onFocus={event => { focused.current = true; completed.current = false; event.currentTarget.select(); }}
			onChange={event => { setDraft(event.target.value); setInvalid(false); changed.current = true; completed.current = false; }}
			onBlur={() => { focused.current = false; if (confirm() && !invalid) setDraft(percentage(scale)); }}
			onKeyDown={event => {
				event.stopPropagation();
				// Explicit completion keeps later circuit shortcuts on this widget.
				// Ordinary blur still leaves focus with the user's outside target.
				const focusCircuit = () => event.currentTarget.closest<HTMLElement>('.logic-circuit')?.focus({ preventScroll: true });
				if (event.key === 'Escape') { event.preventDefault(); completed.current = true; restore(); focusCircuit(); }
				if (event.key === 'Enter') { event.preventDefault(); if (confirm()) focusCircuit(); }
			}} />
		<span aria-hidden="true">%</span>
		{invalid && <span className="logic-scale-validation" id={validationId} role="alert">Enter a percentage from {MIN_SCALE * 100} to {MAX_SCALE * 100}.</span>}
	</label>;
}
