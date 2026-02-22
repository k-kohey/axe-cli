import { execFile } from "node:child_process";
import * as vscode from "vscode";

export interface BinaryResolverDeps {
	which?: (command: string) => Promise<string | null>;
	showPrompt?: (
		message: string,
		...items: string[]
	) => Thenable<string | undefined>;
	openSettings?: (settingId: string) => Promise<void>;
	createTerminal?: (name: string) => vscode.Terminal;
}

function defaultWhich(command: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("which", [command], (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			const p = stdout.trim();
			resolve(p || null);
		});
	});
}

async function defaultOpenSettings(settingId: string): Promise<void> {
	await vscode.commands.executeCommand(
		"workbench.action.openSettings",
		settingId,
	);
}

export class BinaryResolver {
	private cachedPath: string | null = null;
	private readonly deps: Required<BinaryResolverDeps>;

	constructor(deps?: BinaryResolverDeps) {
		this.deps = {
			which: deps?.which ?? defaultWhich,
			showPrompt:
				deps?.showPrompt ??
				((msg, ...items) =>
					vscode.window.showInformationMessage(msg, ...items)),
			openSettings: deps?.openSettings ?? defaultOpenSettings,
			createTerminal:
				deps?.createTerminal ?? ((name) => vscode.window.createTerminal(name)),
		};
	}

	async resolve(): Promise<string> {
		if (this.cachedPath) {
			return this.cachedPath;
		}

		// 1. Check explicit setting
		const cfg = vscode.workspace.getConfiguration("axe");
		const configured = cfg.get<string>("executablePath", "axe");
		if (configured !== "axe") {
			this.cachedPath = configured;
			return configured;
		}

		// 2. Check PATH via `which`
		const whichPath = await this.deps.which("axe");
		if (whichPath) {
			this.cachedPath = whichPath;
			return whichPath;
		}

		// 3. Prompt to install
		const choice = await this.deps.showPrompt(
			"axe CLI was not found. Install it?",
			"Run Install Script",
			"Configure Path",
		);

		if (choice === "Run Install Script") {
			const terminal = this.deps.createTerminal("axe install");
			terminal.show();
			terminal.sendText(
				"curl -fsSL https://raw.githubusercontent.com/k-kohey/axe/main/install.sh | sh",
			);
		}

		if (choice === "Configure Path") {
			await this.deps.openSettings("axe.executablePath");
		}

		throw new Error("axe binary not available");
	}

	clearCache(): void {
		this.cachedPath = null;
	}
}
