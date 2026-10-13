import { useId, type ButtonHTMLAttributes } from 'react';

/** Accessible names without Obsidian's automatic aria-label hover bubbles. */
export function useAccessibleLabel(text: string) {
	const id = useId();
	return { id, label: <span className="logic-sr-only" id={id}>{text}</span> };
}

export function AccessibleButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
	const name = useAccessibleLabel(label);
	return <button {...props} aria-labelledby={name.id}>{name.label}{children}</button>;
}
