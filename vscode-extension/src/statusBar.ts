import * as vscode from "vscode";

export class StatusBar {
	private item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
	}

	showRunning(fileName: string): void {
		this.item.text = `$(eye) axe: ${fileName}`;
		this.item.tooltip = `axe preview running for ${fileName}`;
		this.item.show();
	}

	showError(): void {
		this.item.text = "$(error) axe: error";
		this.item.tooltip = "axe preview encountered an error";
		this.item.show();
	}

	hide(): void {
		this.item.hide();
	}

	dispose(): void {
		this.item.dispose();
	}
}
