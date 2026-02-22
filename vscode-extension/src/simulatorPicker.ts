import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface AvailableDeviceType {
	identifier: string;
	name: string;
	runtimes: { identifier: string; name: string }[];
}

/** Device type + runtime selection for multi-stream mode. */
export interface DeviceSelection {
	deviceType: string;
	runtime: string;
	name: string;
}

const EXEC_TIMEOUT_MS = 30_000;

/**
 * Runs an axe CLI command and returns its stdout.
 */
export function execAxe(
	execPath: string,
	args: string[],
	cwd?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(execPath, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			reject(new Error("axe command timed out"));
		}, EXEC_TIMEOUT_MS);

		proc.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(`axe exited with code ${code}: ${stderr}`));
			}
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Shows a multi-step QuickPick to select a device type and runtime.
 */
async function pickDeviceTypeAndRuntime(
	execPath: string,
	cwd?: string,
): Promise<DeviceSelection | undefined> {
	let available: AvailableDeviceType[];
	try {
		const raw = await execAxe(
			execPath,
			["preview", "simulator", "list", "--available", "--json"],
			cwd,
		);
		available = JSON.parse(raw);
	} catch (err) {
		vscode.window.showErrorMessage(
			`Failed to list available device types: ${err}`,
		);
		return undefined;
	}

	if (available.length === 0) {
		vscode.window.showWarningMessage("No available device types found.");
		return undefined;
	}

	// Step 1: Pick device type.
	interface TypeItem extends vscode.QuickPickItem {
		identifier: string;
		runtimes: { identifier: string; name: string }[];
	}

	const typeItems: TypeItem[] = available.map((dt) => ({
		label: dt.name,
		detail: dt.identifier,
		identifier: dt.identifier,
		runtimes: dt.runtimes,
	}));

	const pickedType = await vscode.window.showQuickPick(typeItems, {
		placeHolder: "Select device type for preview",
	});
	if (!pickedType) {
		return undefined;
	}

	// Step 2: Pick runtime.
	interface RuntimeItem extends vscode.QuickPickItem {
		identifier: string;
	}

	const runtimeItems: RuntimeItem[] = pickedType.runtimes.map((r) => ({
		label: r.name,
		detail: r.identifier,
		identifier: r.identifier,
	}));

	const pickedRuntime = await vscode.window.showQuickPick(runtimeItems, {
		placeHolder: "Select runtime for preview",
	});
	if (!pickedRuntime) {
		return undefined;
	}

	return {
		deviceType: pickedType.identifier,
		runtime: pickedRuntime.identifier,
		name: pickedType.label,
	};
}

/**
 * Shows a multi-step QuickPick to select a device type and runtime for preview.
 * Returns the selection for use with AddStream, or undefined if cancelled.
 */
export async function selectDevice(
	execPath: string,
	cwd?: string,
): Promise<DeviceSelection | undefined> {
	return pickDeviceTypeAndRuntime(execPath, cwd);
}
