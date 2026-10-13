/** DOM type checks must also work in Obsidian's separate popout windows. */
export function eventElement(target: EventTarget | null): Element | null {
	return target && 'nodeType' in target && target.nodeType === 1 ? target as Element : null;
}
