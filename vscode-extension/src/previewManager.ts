import * as vscode from "vscode";
import { spawn as nodeSpawn } from "child_process";
import * as path from "path";
import { getConfig as defaultGetConfig, buildArgs, AxeConfig } from "./config";
import { StatusBar } from "./statusBar";

const KILL_TIMEOUT_MS = 3000;

export interface AxeProcess {
  killed: boolean;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: string): boolean;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: "exit", listener: () => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio: ["pipe", "pipe", "pipe"] }
) => AxeProcess;

export interface OutputChannel {
  appendLine(value: string): void;
  append(value: string): void;
  show(preserveFocus?: boolean): void;
}

export interface StatusBarLike {
  showRunning(fileName: string): void;
  showError(): void;
  hide(): void;
}

export interface InputMessage {
  type: string;
  [key: string]: unknown;
}

export interface PreviewManagerDeps {
  spawn?: SpawnFn;
  getConfig?: () => AxeConfig;
  resolveExecutablePath?: () => Promise<string>;
  onStdoutLine?: (line: string) => void;
  onPreviewStop?: () => void;
}

export class PreviewManager {
  private process: AxeProcess | null = null;
  private currentFile: string | null = null;
  private outputChannel: OutputChannel;
  private statusBar: StatusBarLike;
  private spawnFn: SpawnFn;
  private getConfigFn: () => AxeConfig;
  private resolveExecutablePath?: () => Promise<string>;
  private onStdoutLine?: (line: string) => void;
  private onPreviewStop?: () => void;
  private stdoutBuf = "";

  constructor(
    outputChannel: OutputChannel,
    statusBar: StatusBarLike,
    deps?: PreviewManagerDeps
  ) {
    this.outputChannel = outputChannel;
    this.statusBar = statusBar;
    this.spawnFn = deps?.spawn ?? (nodeSpawn as unknown as SpawnFn);
    this.getConfigFn = deps?.getConfig ?? defaultGetConfig;
    this.resolveExecutablePath = deps?.resolveExecutablePath;
    this.onStdoutLine = deps?.onStdoutLine;
    this.onPreviewStop = deps?.onPreviewStop;
  }

  async startPreview(filePath: string, extraArgs?: string[]): Promise<void> {
    // Idempotent: same file → no-op
    if (this.currentFile === filePath && this.process && !this.process.killed) {
      return;
    }

    // Process alive → switch file via stdin (thunk-only reload)
    if (this.process && !this.process.killed) {
      this.sendInput({ type: "switchFile", path: filePath });
      this.currentFile = filePath;
      const fileName = path.basename(filePath);
      this.statusBar.showRunning(fileName);
      return;
    }

    await this.stopPreview();

    const config = this.getConfigFn();
    const executablePath = this.resolveExecutablePath
      ? await this.resolveExecutablePath()
      : config.executablePath;
    const args = buildArgs(filePath, config);
    if (extraArgs) {
      args.push(...extraArgs);
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    this.outputChannel.appendLine(
      `> ${executablePath} ${args.join(" ")}`
    );
    this.outputChannel.show(true);

    this.process = this.spawnFn(executablePath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.currentFile = filePath;

    const fileName = path.basename(filePath);
    this.statusBar.showRunning(fileName);

    this.stdoutBuf = "";
    this.process.stdout?.on("data", (data: Buffer) => {
      if (this.onStdoutLine) {
        this.stdoutBuf += data.toString();
        const lines = this.stdoutBuf.split("\n");
        this.stdoutBuf = lines.pop() ?? "";
        for (const line of lines) {
          this.onStdoutLine(line);
        }
      } else {
        this.outputChannel.append(data.toString());
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.process.on("error", (err: Error) => {
      this.outputChannel.appendLine(`[axe error] ${err.message}`);
      this.statusBar.showError();
      this.currentFile = null;
    });

    const proc = this.process;
    this.process.on("exit", (code: number | null, signal: string | null) => {
      if (signal) {
        this.outputChannel.appendLine(`[axe] terminated by ${signal}`);
      } else if (code !== 0) {
        this.outputChannel.appendLine(`[axe] exited with code ${code}`);
        this.statusBar.showError();
      }
      // Only clear state if this is still the tracked process.
      // Compare by process identity, not file path, because
      // file switching via stdin updates currentFile without spawning a new process.
      if (this.process === proc) {
        this.process = null;
        this.currentFile = null;
        this.statusBar.hide();
        this.onPreviewStop?.();
      }
    });
  }

  async stopPreview(): Promise<void> {
    if (!this.process) {
      return;
    }

    const proc = this.process;
    this.process = null;
    this.currentFile = null;
    this.statusBar.hide();
    this.onPreviewStop?.();

    if (proc.killed) {
      return;
    }

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
        resolve();
      }, KILL_TIMEOUT_MS);

      proc.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  async restartPreview(extraArgs?: string[]): Promise<void> {
    if (!this.isRunning || !this.currentFile) {
      return;
    }
    const filePath = this.currentFile;
    await this.stopPreview();
    await this.startPreview(filePath, extraArgs);
  }

  nextPreview(): void {
    this.sendInput({ type: "nextPreview" });
  }

  // sendInput writes a JSON Lines command to the axe process stdin.
  sendInput(msg: InputMessage): void {
    if (!this.process || this.process.killed || !this.process.stdin) {
      return;
    }
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  dispose(): void {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
  }
}
