import * as vscode from "vscode";

const PREVIEW_PATTERN = /^\s*#Preview\b/m;

export function containsPreview(document: vscode.TextDocument): boolean {
  return PREVIEW_PATTERN.test(document.getText());
}
