import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const session = `admin-interactions-${process.pid}`;
const execute = promisify(execFile);
const command = async (...args) =>
  (
    await execute(binary, ["--session", session, ...args], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60000,
    })
  ).stdout;
const evaluateFile = async (file) =>
  command(
    "eval",
    await fs.readFile(`tests/admin-interactions/${file}`, "utf8"),
  );
const server = spawn(
  process.execPath,
  ["tests/admin-interactions/server.mjs"],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
const report = {
  environment:
    "Local React route components with fixture loaders/actions; no live Shopify API or database",
  pages: [],
  smoke: [],
  workflows: [],
};
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Fixture server startup timed out")),
      15000,
    );
    server.once("error", reject);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture server exited: ${code}`));
    });
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Local fixture audit")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  const launch = process.env.AGENT_BROWSER_EXECUTABLE_PATH
    ? ["--executable-path", process.env.AGENT_BROWSER_EXECUTABLE_PATH]
    : [];
  await command(...launch, "open", "http://127.0.0.1:4187");
  report.pages = JSON.parse(await evaluateFile("pages.js"));
  console.log(
    `Pages: ${report.pages.length}, failures: ${report.pages.filter((page) => page.error || page.errors.length).length}`,
  );
  await evaluateFile("smoke.js");
  for (let start = 0; start < report.pages.length; start += 5) {
    const batch = JSON.parse(
      await command("eval", `window.runAuditSmoke(${start},${start + 5})`),
    );
    console.log(
      `Click batch ${start / 5 + 1}: ${batch.clicks} clicks, ${batch.failures.length} failures`,
    );
    report.smoke.push(batch);
  }
  await evaluateFile("workflows.js");
  report.workflows = JSON.parse(
    await command("eval", "window.runTargetedAudit()"),
  );
  for (const result of report.workflows)
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? ": " + result.error : ""}`,
    );
  await fs.mkdir("scratch", { recursive: true });
  await fs.writeFile(
    "scratch/admin-click-results.json",
    JSON.stringify(report, null, 2),
  );
  assert.equal(
    report.pages.filter((page) => page.error || page.errors.length).length,
    0,
    "Page render failures",
  );
  assert.equal(
    report.smoke.flatMap((batch) => batch.failures).length,
    0,
    "Click smoke failures; see scratch/admin-click-results.json",
  );
  assert.equal(
    report.workflows.filter((result) => !result.passed).length,
    0,
    "Workflow failures; see scratch/admin-click-results.json",
  );
} finally {
  await command("close").catch(() => {});
  server.kill();
}
