import * as vscode from "vscode";
import { PreviewManager } from "./previewManager";
import { StatusBar } from "./statusBar";
import { containsPreview } from "./previewDetector";
import { BinaryResolver } from "./binaryResolver";
import { SimulatorWebviewPanel } from "./simulatorWebview";

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const MIN_FRAME_LENGTH = 1000;

let previewManager: PreviewManager;
let statusBar: StatusBar;
let webviewPanel: SimulatorWebviewPanel;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("axe SwiftUI Preview");
  statusBar = new StatusBar();

  const resolver = new BinaryResolver();

  webviewPanel = new SimulatorWebviewPanel();

  previewManager = new PreviewManager(outputChannel, statusBar, {
    resolveExecutablePath: () => resolver.resolve(),
    onStdoutLine: (line) => {
      if (line.length >= MIN_FRAME_LENGTH && BASE64_RE.test(line)) {
        webviewPanel.show();
        webviewPanel.postFrame(line);
      }
    },
    // onPreviewStop is intentionally not set — the webview panel
    // is reused across file switches to avoid spawning new tab columns.
  });

  // Connect WebView input events to the preview process.
  webviewPanel.setInputHandler((msg) => {
    previewManager.sendInput(msg);
  });

  // Handle active editor changes
  const editorListener = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (!editor) {
        return;
      }
      handleEditor(editor);
    }
  );

  // Register startPreview command
  const startPreviewCmd = vscode.commands.registerCommand(
    "axe.startPreview",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        previewManager.startPreview(editor.document.uri.fsPath);
      }
    }
  );

  // Register stopPreview command
  const stopPreviewCmd = vscode.commands.registerCommand(
    "axe.stopPreview",
    () => {
      previewManager.stopPreview();
    }
  );

  // Register nextPreview command
  const nextPreviewCmd = vscode.commands.registerCommand(
    "axe.nextPreview",
    () => {
      previewManager.nextPreview();
    }
  );

  // Clear resolver cache when executablePath changes
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("axe.executablePath")) {
      resolver.clearCache();
    }
  });

  context.subscriptions.push(
    editorListener,
    startPreviewCmd,
    stopPreviewCmd,
    nextPreviewCmd,
    configListener,
    {
      dispose: () => {
        previewManager.dispose();
        webviewPanel.dispose();
        statusBar.dispose();
        outputChannel.dispose();
      },
    }
  );

  // Check the currently active editor on activation
  if (vscode.window.activeTextEditor) {
    handleEditor(vscode.window.activeTextEditor);
  }
}

function handleEditor(editor: vscode.TextEditor): void {
  const doc = editor.document;
  if (doc.languageId !== "swift") {
    return;
  }
  if (!containsPreview(doc)) {
    return;
  }
  webviewPanel.resetDismissed();
  previewManager.startPreview(doc.uri.fsPath);
}

export function deactivate(): void {
  previewManager?.dispose();
  webviewPanel?.dispose();
  statusBar?.dispose();
}
