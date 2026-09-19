import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const browserRequired = process.env.REGRESSION_GATE_BROWSER === "required";
const browserState = process.env.AUTH_LOGOUT_TEST_STORAGE_STATE || process.env.LAYOUT_TEST_STORAGE_STATE;
const browserBaseUrl = process.env.AUTH_LOGOUT_TEST_BASE_URL || process.env.LAYOUT_TEST_BASE_URL;

const checks = [
  {
    name: "auth contracts",
    command: "pnpm",
    args: ["--filter", "@workspace/api-server", "run", "test:auth"],
  },
  {
    name: "Kotak compatibility",
    command: "pnpm",
    args: ["--filter", "@workspace/api-server", "run", "test:kotak"],
  },
  {
    name: "authenticated UI source contracts",
    command: "pnpm",
    args: ["--filter", "@workspace/mentors-world", "run", "test:layout"],
  },
];

if (browserRequired) {
  if (!browserState || !existsSync(browserState) || !browserBaseUrl) {
    console.error("Browser regression gates require AUTH_LOGOUT_TEST_STORAGE_STATE and AUTH_LOGOUT_TEST_BASE_URL.");
    process.exit(2);
  }

  checks.push(
    {
      name: "authenticated layout browser smoke",
      command: "pnpm",
      args: ["--filter", "@workspace/mentors-world", "run", "test:layout:browser"],
    },
    {
      name: "local logout browser smoke",
      command: "pnpm",
      args: ["--filter", "@workspace/mentors-world", "run", "test:auth:browser"],
    },
  );
}

for (const check of checks) {
  console.log(`\n[regression-gates] ${check.name}`);
  const result = spawnSync(check.command, check.args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(browserRequired ? {
        LAYOUT_TEST_STORAGE_STATE: process.env.LAYOUT_TEST_STORAGE_STATE || browserState,
        LAYOUT_TEST_BASE_URL: process.env.LAYOUT_TEST_BASE_URL || browserBaseUrl,
        AUTH_LOGOUT_TEST_STORAGE_STATE: process.env.AUTH_LOGOUT_TEST_STORAGE_STATE || browserState,
        AUTH_LOGOUT_TEST_BASE_URL: process.env.AUTH_LOGOUT_TEST_BASE_URL || browserBaseUrl,
      } : {}),
    },
  });
  if (result.error) {
    console.error(`[regression-gates] ${check.name} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[regression-gates] ${check.name} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (!browserRequired) {
  console.warn("\n[regression-gates] Authenticated browser checks were not run.");
  console.warn("[regression-gates] Set REGRESSION_GATE_BROWSER=required with a disposable storage state to make them blocking.");
}

console.log("\n[regression-gates] All configured checks passed.");