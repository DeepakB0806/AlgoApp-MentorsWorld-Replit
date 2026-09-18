import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, "..", "src");

const authenticatedPages = [
  "user-home.tsx",
  "dashboard.tsx",
  "strategies.tsx",
  "webhooks.tsx",
  "broker-api.tsx",
  "user-management.tsx",
  "settings.tsx",
];

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

function pageComponentSource(source, fileName) {
  const componentName = fileName.replace(".tsx", "").split("-").map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join("");
  const marker = `export default function ${componentName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not locate ${marker} in ${fileName}`);
  return source.slice(start);
}

function rootClassName(source, fileName) {
  const componentSource = pageComponentSource(source, fileName);
  const rootMatch = componentSource.match(
    /return\s*\(\s*<div[\s\S]{0,300}?className="([^"]+)"/,
  );
  assert.ok(rootMatch, `Could not locate the page root class in ${fileName}`);
  return rootMatch[1];
}

test("every authenticated page keeps the shared footer", async () => {
  for (const fileName of authenticatedPages) {
    const source = await readSource(join("pages", fileName));
    assert.match(source, /import\s+\{\s*PageFooter\s*\}\s+from\s+"@\/components\/page-footer"/, fileName);
    assert.match(source, /<PageFooter\s*\/>/, `${fileName} must render PageFooter`);
  }
});

test("authenticated page roots remain vertically scrollable", async () => {
  for (const fileName of authenticatedPages) {
    const source = await readSource(join("pages", fileName));
    const rootClass = rootClassName(source, fileName);

    assert.match(rootClass, /\b(?:min-h-screen|min-h-dvh|h-screen)\b/, `${fileName} needs a viewport-height root`);
    assert.doesNotMatch(rootClass, /\boverflow-hidden\b/, `${fileName} must not lock its page root`);
  }
});

test("Broker API keeps its dedicated scroll container", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(
    source,
    /className="h-screen overflow-y-auto overscroll-y-contain bg-background"/,
    "Broker API must have an explicit vertical scroll region",
  );
  assert.match(source, /data-testid="broker-api-scroll-container"/);
});

test("shared styles do not introduce a global scroll lock", async () => {
  const css = await readFile(join(sourceRoot, "index.css"), "utf8");
  assert.doesNotMatch(css, /(?:html|body|#root)[^{]*\{[^}]*overflow(?:-[xy])?\s*:\s*(?:hidden|clip)/s);

  const html = await readFile(join(sourceRoot, "..", "index.html"), "utf8");
  assert.match(html, /name="viewport"[^>]+content="[^"]*width=device-width/);
});

test("representative pages retain their responsive layout contracts", async () => {
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