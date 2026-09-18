import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { getProtectedRouteInventory } from "./route-inventory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "src");

const responsiveContracts = {
  "user-home.tsx": [
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
    "grid md:grid-cols-2 lg:grid-cols-4",
  ],
  "dashboard.tsx": ["overflow-x-auto", "flex-wrap", "sm:w-60"],
  "strategies.tsx": ["overflow-x-auto", "hidden sm:inline"],
  "webhooks.tsx": ["flex-wrap", "flex-col sm:flex-row"],
  "broker-api.tsx": ["overflow-x-auto", "flex-wrap", "grid-cols-1 sm:grid-cols-2"],
  "user-management.tsx": ["flex-wrap", "flex-col sm:flex-row"],
  "settings.tsx": ["overflow-x-auto", "flex-wrap", "grid-cols-1"],
};

async function readSource(relativePath) {
  return readFile(join(sourceRoot, relativePath), "utf8");
}

test("every authenticated page keeps the shared footer", async () => {
  const routes = await getProtectedRouteInventory();
  for (const { pageFile: fileName } of routes) {
    const source = await readSource(join("pages", fileName));
    assert.match(source, /import\s+\{\s*PageFooter\s*\}\s+from\s+"@\/components\/page-footer"/, fileName);
    assert.match(source, /<PageFooter\s*\/>/, `${fileName} must render PageFooter`);
  }
});

test("authenticated pages use the shared scroll shell", async () => {
  const shell = await readSource("components/authenticated-page-shell.tsx");
  assert.match(shell, /h-screen/);
  assert.match(shell, /h-dvh/);
  assert.match(shell, /min-h-0/);
  assert.match(shell, /overflow-y-auto/);
  assert.match(shell, /overscroll-y-contain/);
  assert.match(shell, /bg-background/);

  const routes = await getProtectedRouteInventory();
  for (const { pageFile: fileName } of routes) {
    const source = await readSource(join("pages", fileName));
    assert.match(
      source,
      /import\s+\{\s*AuthenticatedPageShell\s*\}\s+from\s+"@\/components\/authenticated-page-shell"/,
      `${fileName} must import the shared page shell`,
    );
    assert.match(source, /<AuthenticatedPageShell(?:\s[^>]*)?>/, `${fileName} must render the shared page shell`);
  }
});

test("Broker API keeps its scroll-container marker", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(source, /<AuthenticatedPageShell testId="broker-api-scroll-container">/);
});

test("shared styles do not introduce a global scroll lock", async () => {
  const css = await readFile(join(sourceRoot, "index.css"), "utf8");
  assert.doesNotMatch(css, /(?:html|body|#root)[^{]*\{[^}]*overflow(?:-[xy])?\s*:\s*(?:hidden|clip)/s);

  const html = await readFile(join(sourceRoot, "..", "index.html"), "utf8");
  assert.match(html, /name="viewport"[^>]+content="[^"]*width=device-width/);
});

test("representative pages retain their responsive layout contracts", async () => {
  const routes = await getProtectedRouteInventory();
  const routePageFiles = new Set(routes.map(({ pageFile }) => pageFile));
  assert.deepEqual(
    new Set(Object.keys(responsiveContracts)),
    routePageFiles,
    "Every protected route must have an explicit responsive contract",
  );

  for (const [fileName, requiredClasses] of Object.entries(responsiveContracts)) {
    const source = await readSource(join("pages", fileName));
    for (const requiredClass of requiredClasses) {
      assert.match(
        source,
        new RegExp(requiredClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${fileName} is missing responsive contract: ${requiredClass}`,
      );
    }
  }
});