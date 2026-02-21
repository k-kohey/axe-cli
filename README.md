# axe

Command-line development tools for iOS simulators — live-preview SwiftUI views with hot-reload support, interactive simulator control, and view hierarchy inspection.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/k-kohey/axe/main/install.sh | sh
```

Or download a binary manually from the [Releases](https://github.com/k-kohey/axe/releases) page.

The `preview` command requires `idb_companion` for headless simulator management:

```bash
brew install facebook/fb/idb-companion
```

## VSCode Extension

A VSCode extension that enables interactive SwiftUI previews directly in VSCode / Cursor. See [vscode-extension/README.md](vscode-extension/README.md) for details.
Download the `.vsix` file from the [Releases](https://github.com/k-kohey/axe/releases) page, then:

- **VS Code**: `code --install-extension axe-swiftui-preview-<version>.vsix`
- **Cursor**: `Cmd+Shift+P` > "Install from VSIX..." and select the file

### Development Setup

Install dependencies using [mise](https://mise.jdx.dev/):

```bash
mise install
```

## Run & Test

```bash
# Run
mise run exec -- --help

# Test
mise run test
```

## Known Issues

### Hot Reload (`preview --watch`)

- **Computed properties and methods are hot-reloaded**: The parser extracts computed properties (`var x: T { ... }`) and methods (`func`) for `@_dynamicReplacement`. Generic methods (`func foo<T>(...)`), `static`/`class` methods, and initializers are not hot-reloaded. Stored properties (`let`, `@State`, `@Published`, etc.) cannot be dynamically replaced (memory layout constraint) and automatically trigger a full rebuild via skeleton comparison.
- **Transitive dependency changes are not detected**: The watcher tracks files that directly define types used in the target file. Changes to files used indirectly (e.g. a model's dependency) do not trigger a rebuild. Re-save the target file to force a reload.

### Source Parsing

- **Indirect protocol conformance is not detected**: Conformance via protocol composition (e.g. `struct Foo: MyProtocol` where `MyProtocol: View`) is not recognized. Direct `: View`, `SwiftUI.View`, and `extension`-based conformance are all supported.

### Preview Macro

- **`#Preview(traits:)` is not supported**: Display trait parameters such as `#Preview(traits: .landscapeLeft)` are ignored.

### Platform

- **Apple Silicon only**: The preview compiler targets `arm64` exclusively. Intel Macs are not supported.
