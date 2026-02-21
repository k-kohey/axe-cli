import * as assert from "assert";
import { SimulatorWebviewPanel, SimulatorWebviewDeps, InputMessage } from "../simulatorWebview";

interface FakeWebviewPanel {
  viewType: string;
  title: string;
  showOptions: unknown;
  options: unknown;
  webview: {
    html: string;
    messages: unknown[];
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(listener: (msg: unknown) => void): { dispose(): void };
    _messageListeners: ((msg: unknown) => void)[];
  };
  disposed: boolean;
  onDidDispose(listener: () => void): { dispose(): void };
  dispose(): void;
  _disposeListeners: (() => void)[];
}

function createFakePanel(): FakeWebviewPanel {
  const disposeListeners: (() => void)[] = [];
  const messages: unknown[] = [];
  const messageListeners: ((msg: unknown) => void)[] = [];
  return {
    viewType: "",
    title: "",
    showOptions: undefined,
    options: undefined,
    webview: {
      html: "",
      messages,
      _messageListeners: messageListeners,
      postMessage(message: unknown): Thenable<boolean> {
        messages.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(listener: (msg: unknown) => void) {
        messageListeners.push(listener);
        return { dispose() {} };
      },
    },
    disposed: false,
    _disposeListeners: disposeListeners,
    onDidDispose(listener: () => void) {
      disposeListeners.push(listener);
      return { dispose() {} };
    },
    dispose() {
      this.disposed = true;
      for (const l of disposeListeners) {
        l();
      }
    },
  };
}

function createDeps(panel: FakeWebviewPanel): SimulatorWebviewDeps {
  return {
    createWebviewPanel: (viewType, title, showOptions, options) => {
      panel.viewType = viewType;
      panel.title = title;
      panel.showOptions = showOptions;
      panel.options = options;
      return panel as unknown as import("vscode").WebviewPanel;
    },
  };
}

suite("SimulatorWebviewPanel", () => {
  test("show creates a webview panel", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    webview.show();

    assert.strictEqual(fakePanel.viewType, "axe.simulatorPreview");
    assert.strictEqual(fakePanel.title, "axe Preview");
    assert.ok(fakePanel.webview.html.includes("<img"));
    assert.strictEqual(webview.visible, true);
  });

  test("show is idempotent", () => {
    let createCount = 0;
    const fakePanel = createFakePanel();
    const deps: SimulatorWebviewDeps = {
      createWebviewPanel: (viewType, title, showOptions, options) => {
        createCount++;
        fakePanel.viewType = viewType;
        fakePanel.title = title;
        fakePanel.showOptions = showOptions;
        fakePanel.options = options;
        return fakePanel as unknown as import("vscode").WebviewPanel;
      },
    };
    const webview = new SimulatorWebviewPanel(deps);

    webview.show();
    webview.show();

    assert.strictEqual(createCount, 1);
  });

  test("postFrame sends message to webview", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    webview.show();
    webview.postFrame("AAAA");

    assert.deepStrictEqual(fakePanel.webview.messages, [
      { type: "frame", data: "AAAA" },
    ]);
  });

  test("postFrame is no-op when panel is not shown", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    // Should not throw
    webview.postFrame("AAAA");
    assert.strictEqual(fakePanel.webview.messages.length, 0);
  });

  test("dispose closes the panel", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    webview.show();
    webview.dispose();

    assert.strictEqual(fakePanel.disposed, true);
    assert.strictEqual(webview.visible, false);
  });

  test("dispose is safe when no panel exists", () => {
    const webview = new SimulatorWebviewPanel({ createWebviewPanel: () => createFakePanel() as unknown as import("vscode").WebviewPanel });

    // Should not throw
    webview.dispose();
    assert.strictEqual(webview.visible, false);
  });

  test("onDispose callback fires when panel is closed externally", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    let disposed = false;
    webview.show(() => { disposed = true; });

    // Simulate user closing the panel
    fakePanel.dispose();

    assert.strictEqual(disposed, true);
    assert.strictEqual(webview.visible, false);
  });

  test("show is suppressed after user closes panel", () => {
    let createCount = 0;
    const panels: FakeWebviewPanel[] = [];
    const deps: SimulatorWebviewDeps = {
      createWebviewPanel: () => {
        createCount++;
        const p = createFakePanel();
        panels.push(p);
        return p as unknown as import("vscode").WebviewPanel;
      },
    };
    const webview = new SimulatorWebviewPanel(deps);

    webview.show();
    panels[0].dispose(); // user closes panel
    webview.show(); // should NOT re-create

    assert.strictEqual(createCount, 1);
    assert.strictEqual(webview.visible, false);
  });

  test("resetDismissed allows show after user close", () => {
    let createCount = 0;
    const panels: FakeWebviewPanel[] = [];
    const deps: SimulatorWebviewDeps = {
      createWebviewPanel: () => {
        createCount++;
        const p = createFakePanel();
        panels.push(p);
        return p as unknown as import("vscode").WebviewPanel;
      },
    };
    const webview = new SimulatorWebviewPanel(deps);

    webview.show();
    panels[0].dispose(); // user closes panel
    webview.resetDismissed();
    webview.show(); // should re-create

    assert.strictEqual(createCount, 2);
    assert.strictEqual(webview.visible, true);
  });

  test("setInputHandler receives touchDown messages", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    const received: InputMessage[] = [];
    webview.setInputHandler((msg) => { received.push(msg); });

    webview.show();

    const touchDownMsg: InputMessage = { type: "touchDown", x: 0.5, y: 0.3 };
    for (const listener of fakePanel.webview._messageListeners) {
      listener(touchDownMsg);
    }

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, "touchDown");
    assert.strictEqual(received[0].x, 0.5);
    assert.strictEqual(received[0].y, 0.3);
  });

  test("setInputHandler receives touchMove messages", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    const received: InputMessage[] = [];
    webview.setInputHandler((msg) => { received.push(msg); });

    webview.show();

    const touchMoveMsg: InputMessage = { type: "touchMove", x: 0.6, y: 0.4 };
    for (const listener of fakePanel.webview._messageListeners) {
      listener(touchMoveMsg);
    }

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, "touchMove");
  });

  test("setInputHandler receives touchUp messages", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    const received: InputMessage[] = [];
    webview.setInputHandler((msg) => { received.push(msg); });

    webview.show();

    const touchUpMsg: InputMessage = { type: "touchUp", x: 0.9, y: 0.8 };
    for (const listener of fakePanel.webview._messageListeners) {
      listener(touchUpMsg);
    }

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, "touchUp");
    assert.strictEqual(received[0].x, 0.9);
    assert.strictEqual(received[0].y, 0.8);
  });

  test("setInputHandler receives text messages", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    const received: InputMessage[] = [];
    webview.setInputHandler((msg) => { received.push(msg); });

    webview.show();

    const textMsg: InputMessage = { type: "text", value: "a" };
    for (const listener of fakePanel.webview._messageListeners) {
      listener(textMsg);
    }

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, "text");
    assert.strictEqual(received[0].value, "a");
  });

  test("HTML includes interactive event handlers", () => {
    const fakePanel = createFakePanel();
    const webview = new SimulatorWebviewPanel(createDeps(fakePanel));

    webview.show();

    assert.ok(fakePanel.webview.html.includes("mousedown"));
    assert.ok(fakePanel.webview.html.includes("mouseup"));
    assert.ok(fakePanel.webview.html.includes("mouseleave"));
    assert.ok(fakePanel.webview.html.includes("keypress"));
    assert.ok(fakePanel.webview.html.includes("vscode.postMessage"));
    assert.ok(fakePanel.webview.html.includes("touchDown"));
    assert.ok(fakePanel.webview.html.includes("touchMove"));
    assert.ok(fakePanel.webview.html.includes("touchUp"));
    assert.ok(fakePanel.webview.html.includes("image/jpeg"));
  });
});
