import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../");
	const extensionTestsPath = path.resolve(__dirname, "./index");

	await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch((err) => {
	console.error("Failed to run tests:", err);
	process.exit(1);
});
