import * as vscode from "vscode";
import { InputMessage } from "./previewManager";

export { InputMessage };

export interface SimulatorWebviewDeps {
  createWebviewPanel?: (
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn,
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  ) => vscode.WebviewPanel;
}

export class SimulatorWebviewPanel {
  private panel: vscode.WebviewPanel | null = null;
  private createPanel: NonNullable<SimulatorWebviewDeps["createWebviewPanel"]>;
  private dismissed = false;
  private onInput?: (msg: InputMessage) => void;

  constructor(deps?: SimulatorWebviewDeps) {
    this.createPanel =
      deps?.createWebviewPanel ??
      ((viewType, title, showOptions, options) =>
        vscode.window.createWebviewPanel(viewType, title, showOptions, options));
  }

  setInputHandler(handler: (msg: InputMessage) => void): void {
    this.onInput = handler;
  }

  show(onDispose?: () => void): void {
    if (this.dismissed || this.panel) {
      return;
    }
    this.panel = this.createPanel(
      "axe.simulatorPreview",
      "axe Preview",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    this.panel.webview.html = getWebviewHtml();
    this.panel.webview.onDidReceiveMessage((msg: InputMessage) => {
      this.onInput?.(msg);
    });
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.dismissed = true;
      onDispose?.();
    });
  }

  resetDismissed(): void {
    this.dismissed = false;
  }

  postFrame(base64: string): void {
    this.panel?.webview.postMessage({ type: "frame", data: base64 });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  get visible(): boolean {
    return this.panel !== null;
  }
}

function getWebviewHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: #1e1e1e; overflow: hidden; }
    img { max-width: 100%; max-height: 100vh; object-fit: contain; user-select: none; -webkit-user-drag: none; }
  </style>
</head>
<body>
  <img id="preview" />
  <script>
    const vscode = acquireVsCodeApi();
    const img = document.getElementById('preview');

    window.addEventListener('message', (e) => {
      if (e.data.type === 'frame') {
        img.src = 'data:image/jpeg;base64,' + e.data.data;
      }
    });

    let dragStart = null;
    let moveScheduled = false;
    img.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = img.getBoundingClientRect();
      dragStart = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        time: Date.now()
      };
      vscode.postMessage({ type: 'touchDown', x: dragStart.x, y: dragStart.y });
    });
    img.addEventListener('mousemove', (e) => {
      if (!dragStart || moveScheduled) return;
      moveScheduled = true;
      const rect = img.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      requestAnimationFrame(() => {
        vscode.postMessage({ type: 'touchMove', x, y });
        moveScheduled = false;
      });
    });
    img.addEventListener('mouseup', (e) => {
      if (!dragStart) return;
      const rect = img.getBoundingClientRect();
      const endX = (e.clientX - rect.left) / rect.width;
      const endY = (e.clientY - rect.top) / rect.height;
      vscode.postMessage({ type: 'touchUp', x: endX, y: endY });
      dragStart = null;
    });
    img.addEventListener('mouseleave', (e) => {
      if (!dragStart) return;
      const rect = img.getBoundingClientRect();
      const endX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const endY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      vscode.postMessage({ type: 'touchUp', x: endX, y: endY });
      dragStart = null;
    });

    document.addEventListener('keypress', (e) => {
      if (e.key.length === 1) {
        vscode.postMessage({ type: 'text', value: e.key });
      }
    });
  </script>
</body>
</html>`;
}
