import * as assert from "assert";
import * as vscode from "vscode";
import { containsPreview } from "../previewDetector";

suite("previewDetector", () => {
  function makeDoc(content: string): vscode.TextDocument {
    // Use a minimal duck-type that satisfies getText()
    return { getText: () => content } as vscode.TextDocument;
  }

  test("detects #Preview at the start of a line", () => {
    const doc = makeDoc(`import SwiftUI\n\n#Preview {\n  Text("Hello")\n}`);
    assert.strictEqual(containsPreview(doc), true);
  });

  test("detects #Preview with leading whitespace", () => {
    const doc = makeDoc(`  #Preview("Dark") {\n  Text("Hi")\n}`);
    assert.strictEqual(containsPreview(doc), true);
  });

  test("does not match #Preview inside a comment", () => {
    // Single-line comment: starts with //, so #Preview is not at line start
    const doc = makeDoc(`// #Preview {\n}`);
    assert.strictEqual(containsPreview(doc), false);
  });

  test("does not match partial word like #PreviewProvider", () => {
    // #Preview\b ensures word boundary
    const doc = makeDoc(`struct Foo: #PreviewProvider {}`);
    assert.strictEqual(containsPreview(doc), false);
  });

  test("returns false for file without #Preview", () => {
    const doc = makeDoc(`import SwiftUI\nstruct MyView: View {\n  var body: some View { Text("Hi") }\n}`);
    assert.strictEqual(containsPreview(doc), false);
  });

  test("detects #Preview with title argument", () => {
    const doc = makeDoc(`#Preview("Landscape") {\n  ContentView()\n}`);
    assert.strictEqual(containsPreview(doc), true);
  });
});
