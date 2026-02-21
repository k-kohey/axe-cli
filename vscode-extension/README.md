# axe SwiftUI Preview — VS Code Extension

A VS Code / Cursor extension that automatically runs `axe preview` when you open a Swift file containing `#Preview`. Switch to another `#Preview` file and the previous process is stopped and a new one is started.

## Requirements

- [axe CLI](https://github.com/k-kohey/axe) installed and available in your PATH (or configured via `axe.executablePath`)
- A `.axerc` file or extension settings configured with your project/workspace and scheme

## Features

- **Auto-start**: Opening a Swift file with `#Preview` automatically runs `axe preview <file> --watch`
- **Auto-switch**: Switching to a different `#Preview` file kills the previous process and starts a new one
- **Preserve on non-preview files**: Switching to a Swift file without `#Preview` keeps the existing preview running
- **Next Preview**: Cycle through multiple `#Preview` blocks in the same file via the `axe: Next Preview` command
- **Status bar**: Shows the currently previewed file name, or an error indicator
- **Output channel**: All `axe` stdout/stderr is streamed to the "axe SwiftUI Preview" output channel

## Installation

### From VSIX (local development)

```bash
cd vscode-extension
pnpm install
pnpm run compile
npx vsce package
```

Then install the generated `.vsix`:

- **VS Code**: `code --install-extension axe-swiftui-preview-0.1.0.vsix`
- **Cursor**: `Cmd+Shift+P` > "Install from VSIX..." and select the file

## Settings

All settings are optional. When left empty, `axe` falls back to the corresponding `.axerc` values.

| Setting | Description | Default |
|---------|-------------|---------|
| `axe.executablePath` | Path to the `axe` binary | `"axe"` |
| `axe.project` | Path to `.xcodeproj` (`--project` flag) | `""` |
| `axe.workspace` | Path to `.xcworkspace` (`--workspace` flag) | `""` |
| `axe.scheme` | Xcode scheme (`--scheme` flag) | `""` |
| `axe.configuration` | Build configuration (`--configuration` flag) | `""` |
| `axe.additionalArgs` | Extra CLI arguments | `[]` |

## Commands

| Command | Description |
|---------|-------------|
| `axe: Next Preview` | Cycle to the next `#Preview` block in the current file |

You can bind this command to a keyboard shortcut via `keybindings.json`:

```json
{
  "key": "ctrl+shift+n",
  "command": "axe.nextPreview"
}
```

## Development

```bash
cd vscode-extension
pnpm install
pnpm run compile   # build once
pnpm run watch     # rebuild on file changes
pnpm test          # run tests (launches a VS Code instance)
```

To debug in VS Code, open the `vscode-extension/` folder and press `F5` to launch the Extension Development Host.

---

# axe SwiftUI Preview — VS Code 拡張機能

`#Preview` マクロを含む Swift ファイルを開くと、自動的に `axe preview` を実行する VS Code / Cursor 拡張機能です。別の `#Preview` ファイルに切り替えると、前のプロセスを停止して新しいプロセスを起動します。

## 必要なもの

- [axe CLI](https://github.com/k-kohey/axe) がインストール済みで PATH に通っていること（または `axe.executablePath` で設定）
- `.axerc` ファイル、または拡張機能の設定で project/workspace と scheme が設定されていること

## 機能

- **自動起動**: `#Preview` を含む Swift ファイルを開くと `axe preview <file> --watch` を自動実行
- **自動切り替え**: 別の `#Preview` ファイルに切り替えると、前のプロセスを kill して新しいプロセスを起動
- **非 Preview ファイルでの維持**: `#Preview` を含まない Swift ファイルに切り替えても、既存のプレビューを維持
- **Next Preview**: `axe: Next Preview` コマンドで同一ファイル内の複数の `#Preview` ブロックを順番に切り替え
- **ステータスバー**: 現在プレビュー中のファイル名、またはエラー状態を表示
- **出力チャンネル**: `axe` の stdout/stderr を「axe SwiftUI Preview」出力チャンネルにストリーム表示

## インストール

### VSIX からインストール（ローカル開発用）

```bash
cd vscode-extension
pnpm install
pnpm run compile
npx vsce package
```

生成された `.vsix` をインストール:

- **VS Code**: `code --install-extension axe-swiftui-preview-0.1.0.vsix`
- **Cursor**: `Cmd+Shift+P` > 「Install from VSIX...」でファイルを選択

## 設定

すべての設定は省略可能です。空の場合、`axe` は `.axerc` の対応する値にフォールバックします。

| 設定 | 説明 | デフォルト |
|------|------|-----------|
| `axe.executablePath` | `axe` バイナリのパス | `"axe"` |
| `axe.project` | `.xcodeproj` のパス (`--project` フラグ) | `""` |
| `axe.workspace` | `.xcworkspace` のパス (`--workspace` フラグ) | `""` |
| `axe.scheme` | Xcode スキーム (`--scheme` フラグ) | `""` |
| `axe.configuration` | ビルド構成 (`--configuration` フラグ) | `""` |
| `axe.additionalArgs` | 追加の CLI 引数 | `[]` |

## コマンド

| コマンド | 説明 |
|---------|------|
| `axe: Next Preview` | 現在のファイル内の次の `#Preview` ブロックに切り替え |

`keybindings.json` でキーボードショートカットを割り当てることができます:

```json
{
  "key": "ctrl+shift+n",
  "command": "axe.nextPreview"
}
```

## 開発

```bash
cd vscode-extension
pnpm install
pnpm run compile   # ビルド
pnpm run watch     # ファイル変更時に自動ビルド
pnpm test          # テスト実行（VS Code インスタンスが起動します）
```

VS Code でデバッグするには、`vscode-extension/` フォルダを開いて `F5` で Extension Development Host を起動してください。
