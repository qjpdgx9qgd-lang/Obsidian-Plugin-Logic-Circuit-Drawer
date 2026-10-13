# Verification record

Verified on 13 October 2026, with native Obsidian 1.14.4 on macOS.

## Automated checks

- `npm test`: 147 tests passed, covering circuit validation, junction operations, compound undo/redo, safe Markdown updates, insertion boundaries, copied-block races, save queues, conflict recovery, oversized/malformed data, aligned connector geometry, cardinal junction routing, whole-percentage scale steps, session ownership, and guarded block deletion/reordering. Regression cases include self-feedback through every gate, generic errors without object numbers or labels, exact line-slot spacing, repeated LF/CRLF moves without accumulating blank lines, ordinary selection lifecycle and isolation, note-only menu/command eligibility, delayed menu guards, the default insertion shortcut, insertion without trailing blank lines, deletion caret placement, and guarded line insertion before/after a block.
- `npm run package`: TypeScript compilation and production esbuild bundle passed; installable files were copied to `dist/logic-circuits/`.
- `npx tsc --project tests/tsconfig.json --noEmit`: test and harness types passed.
- `npm run lint`: no errors. Two advisories remain: Obsidian discourages default shortcuts, but the requested insertion shortcut is an explicit product requirement; the settings search API is newer than the supported minimum version. The default scale remains available in the plugin's settings tab.
- `git diff --check` and `node --check main.js`: passed.
- Release metadata uses `logic-circuits`, credits Yinlong Zhao, and declares MIT. The packaged manifest, version map, and npm metadata agree. Build notices include the original 0BSD sample license and the exact license text of bundled dependencies; the complete notices are embedded in `main.js` and supplied separately in the package.
- Runtime dependency audit: no known runtime vulnerabilities reported at verification time.

## Browser interaction checks

`npm run test:ui` launches two isolated Chromium harnesses. The diagram harness uses the real editor, model, and editing session with an in-memory note store. It verifies:

- One-shot placement and toolbar drag-and-drop.
- Terminal label editing, normal and reversed connection gestures, snapped movement, and no saves during pointer movement.
- Both branching gestures and atomic branch undo/redo.
- Selection and movement of junction dots without moving unrelated objects.
- Connectivity-preserving junction deletion, branch-wire deletion, and terminal deletion with wire cleanup.
- Light/dark rendering, Fit, Done, saved reopening, responsive full visibility, and normal note scrolling.
- Inline conflict feedback, preserved external Markdown, and explicit reload recovery.
- Hover-only controls after mouse selection, keyboard access to hidden controls, manual zoom entry with Enter/blur/Escape and invalid-value rejection.
- Control and wire accessible names use hidden label references without tooltip-triggering `aria-label` attributes. Native tooltip titles stay short.
- Temporary action and scale errors expire after four seconds; repeated errors restart the timer. Save conflicts and malformed-source errors stay visible.
- Outside clicks finish editing, commit the typed terminal label, and wait for pending writes. Conflicting saves retain the draft and recovery controls. Internal controls and the circuit's own context menu do not finish prematurely.
- Deletion under a native-like outer `contenteditable=true` Markdown container, while label/zoom fields retain normal text deletion.
- The rubbish bin control and its disabled state when nothing is selected.
- Same-gate output-to-input dragging creates a continuous feedback loop that survives undo, redo, Done, and reopening. An occupied input reports the generic message “This input pin is already connected.”
- Exact SVG connector-to-wire equality across all seven gate types at 50%, 100%, and 150%, plus normal and reversed live connection previews.
- Gate centers, every gate pin, terminal markers, and junction centers share the snapping lattice; aligned connections remain straight.
- Solid junction dots meet wires continuously from all four cardinal sides, with forward and reversed gestures through the cardinal connection targets persisting the original logical pin IDs.
- Whole 10-point scale changes from fractional starting percentages, while Fit retains its exact scale.
- Compact single-row height, live bottom growth and shrinkage during node movement, click placement previews, and toolbar drag-and-drop. The top and other nodes remain fixed, and pointer motion does not save.
- A single fast pointer movement retains its full drag distance. Selecting a saved off-grid node alone preserves its coordinates and does not write to the note.
- Suppression of the native circuit wrapper's hover editor button without hiding unrelated code-block controls.
- The exact NAND/XOR layout from **my test**: splitting the vertical trunk preserves its top/bottom continuation, and the XOR branch leaves the junction to the right without an extra left leg.

The second harness uses a real CodeMirror document, view, undo history, and the plugin's Live Preview extension, with a small Obsidian API adapter. It verifies:

- Adding a node keeps editing open across its save, widget rebuild, and a fallback Markdown mount.
- A fallback-first mount acquires the editor host even when Obsidian assigns its mutable editor metadata later. Replacing the old view retains the new owner's session.
- Changes before the circuit shift its location while retaining the editing session.
- Double-clicking a finished block's background or visible gate opens inline editing, clears whole-block selection, and leaves Markdown and its transaction history unchanged. Double-clicking the scale field retains its own behavior; terminal-label double-clicks while editing continue to open the label editor.
- Node Delete removes only the node; selected-block Delete removes only the intended fence and places the caret on the surviving line. Normal note Undo restores the fence and its selection transaction.
- **Delete circuit** appears at the top left only while editing and stays visible without hover. Its header does not overlap the scale controls at normal or 288-pixel block width. Selecting it removes exactly the intended fence, preserves the rest of the note, focuses the caret at the deletion boundary, and supports one normal note Undo.
- The circuit-specific context menu exposes **Insert line before**, **Insert line after**, and **Delete circuit block**. Both line actions create exactly one blank line, focus its caret, preserve circuit data and surrounding text, and support normal note Undo. Conflicting document changes reject the action without moving the caret.
- Selection clears on outside clicks, keyboard focus elsewhere, window blur, and final widget unmount, including malformed circuits. In-block controls retain selection; focusing a diagram node makes Delete target that node. The separate selection button is absent; the border and grip select the whole block.
- Ordinary note closure/reopening does not restore a cached block selection. These selection changes do not write Markdown or affect diagram history.
- Outside clicks finish editing after active field confirmation and pending saves. A non-focusable target that immediately removes the widget preserves both an unfinished terminal label and a typed scale. Returning inside during a pending save cancels the earlier close intent; a subsequent outside click can finish normally. Widget replacement during saving alone keeps editing open, and conflicts retain the draft. Insertion adds no extra blank line after the fence.
- A native HTML drag from the block grip moves the exact raw fence lines in one two-change transaction, preserves the active editing session, and supports one normal note Undo. The assertion compares the entire Markdown text, including blank-line spacing.
- A note change after choosing the drop position rejects the drop atomically.
- Plugin unload removes React roots and Reading drag controllers once; later render-child unloads and late asynchronous mounts remain safe.
- Detached native Markdown renders wait for attachment before acquiring their source editor and drag grip. Later attachment after child/plugin unload does not mount a root or retain an observer. Navigation during a pending note read rejects the stale mount.

The harness captures screenshots and reports their temporary-directory location. It checks for unhandled browser errors. Screenshot checks supplement the automated interaction assertions; they are not pixel-comparison tests.

## Native Obsidian checks

A dedicated **Logic circuit verification** note was created in the test vault. Native checks confirmed:

- The plugin loads and exposes its insertion command.
- Inserting in Live Preview activates the editor in place; placing a gate saves it.
- Done hides the editing toolbar.
- Reading view renders the saved diagram, opens the editor inline, and saves display-scale changes.
- Source mode exposes the persisted fenced JSON.
- Two complete labeled Input → AND → Output circuits render together and retain independent scales.
- Saving one circuit preserves the other circuit, intervening text, and the malformed test block's exact original content.
- Malformed JSON produces a helpful inline error in Live Preview.
- Closing and reopening the note retains labels, connections, and saved scale.
- An editing session remains usable after scrolling and returning to its block.
- Follow-up fixes: wire continuity and compact labeled terminal markers were inspected in native Live Preview; the additional **Edit this block** overlay was absent.
- A separate **Logic circuit keyboard verification** note confirmed both Backspace and forward Delete remove a selected gate without deleting its Markdown block. The rubbish bin also removed the selected gate; manually entering 75% persisted the scale.
- The rebuilt plugin was reloaded and checked again in that separate note: 89.2% increases to 90%; a gate moves down beyond the previous lower boundary and back up while the block grows and shrinks with a fixed top. The temporary gate was removed and the note's 75% scale restored after verification.
- The junction in **my test** now retains the vertical trunk and connects to the XOR gate from the right side of the dot. The note's original circuit data was not changed.
- A new **Logic circuit block verification** note confirmed adding a gate keeps **Done** visible and saves the edit. Selecting its first block and pressing Backspace removed only that fence; normal note Undo restored it and preserved the second circuit and surrounding prose.
- The final build was reloaded through Community plugins. Both blocks show drag grips after attachment, and selecting a block then clicking an outside paragraph clears its selection. These checks did not change circuit data or note text.
- The latest build was reloaded through Community plugins. The separate selection button is gone. Native **Settings → Hotkeys** shows **Cmd + Shift + L** for **Insert logic circuit** and no default binding for the separate recovery command.

Native checks above record the earlier installed macOS builds. The latest tooltip, timed-error, natural selection, caret, spacing, outside-click completion, and before/after menu changes are verified by the browser harness and unit tests; double-click editor entry and the **Delete circuit** button are verified by the browser harness. These changes have not been rechecked in the native app. The CodeMirror harness exercises the plugin's actual decoration and session lifecycle, but its Obsidian adapter cannot reproduce every native host behavior. Native whole-block drag remains unverified: the automation gesture did not reorder the note, and its original text was confirmed unchanged. Reading-view drop interactions remain unverified in the native app; Reading drop-range mapping is covered by unit tests. Windows, Linux, and the minimum supported Obsidian version have not been manually tested in this environment.

## Known first-release limits

See [README.md](README.md) for usage and limits. Native macOS Insert-menu integration is unavailable through the installed public plugin API. Circuits must use standalone, unindented fences outside note metadata. Routing has no obstacle avoidance or draggable elbows. Recovery drafts and undo history are held in memory. No mobile support or simulation is provided.
