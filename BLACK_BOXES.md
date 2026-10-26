# Black boxes

Black boxes are labelled squares that stand in for a circuit you reuse. They are drawing aids only: nothing expands or simulates them.

## Using black boxes in Obsidian

1. Build and install the plugin:
   ```sh
   npm install
   npm run build
   ```
   Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/logic-circuits/`, then reload Obsidian and enable **Logic circuits**.
2. Open a note in Live Preview and insert a logic circuit, or double-click an existing circuit and select **Edit**.
3. Select **Box** in the toolbar, then click in the diagram. You can also drag **Box** into the diagram.
4. In the dialog, enter:
   - **Label** — for example `FA` or `ALU`.
   - **Inputs** — 0 to 8 pins on the left edge.
   - **Outputs** — 0 to 8 pins on the right edge.
   Then select **Place**.
5. Drag between pins to wire the box exactly like a gate. Each input accepts one wire; each output can feed several targets and can be branched with a junction.
6. Double-click the square to edit its label. Select it and click the gear button in its top-right corner to change the label or pin counts later.
7. Select **Done** when finished. Black boxes, their labels, and their pin counts are saved inside the `logic-circuit` fenced block and participate in undo/redo.

A full adder is therefore one box labelled `FA` with three inputs (`in-1`, `in-2`, `in-3`) and two outputs (`out-1`, `out-2`).

If you lower a pin count while a wire still uses a pin that would disappear, the change is refused. Disconnect that wire first, then reconfigure the box.

## Making a branch, committing, and publishing it

The feature is implemented on a local branch. To publish it under your own GitHub account:

1. Fork the repository on GitHub: open <https://github.com/watawata39/Obsidian-Plugin-Logic-Circuit-Drawer>, select **Fork**, and create the fork under your account.
2. In your local checkout, point `origin` at your fork and keep the original as `upstream`. Replace `<you>` with your GitHub username:
   ```sh
   git remote rename origin upstream
   git remote add origin https://github.com/<you>/Obsidian-Plugin-Logic-Circuit-Drawer.git
   git fetch upstream
   git checkout -b feature/black-boxes upstream/main
   ```
   If you already have the prepared checkout, just verify the remote:
   ```sh
   git remote -v
   git checkout feature/black-boxes
   ```
3. Make or review your changes, then verify them:
   ```sh
   npm install
   npm run lint
   npm test
   npm run build
   ```
4. Commit the change:
   ```sh
   git add -A
   git commit -m "Add reusable black box nodes"
   ```
5. Push the branch to your fork:
   ```sh
   git push -u origin feature/black-boxes
   ```
6. Open a pull request: go to your fork on GitHub, select **Compare & pull request**, set the base repository to `watawata39/Obsidian-Plugin-Logic-Circuit-Drawer` and the base branch to `main`, then describe the feature and submit.

The built `main.js`, `manifest.json`, and `styles.css` are the installable plugin files. The repository ignores generated `main.js` and `dist/`, so do not commit build output unless you intentionally change that policy.
