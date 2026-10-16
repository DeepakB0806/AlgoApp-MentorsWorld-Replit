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

test("public home page owns a production-safe scroll shell", async () => {
  const source = await readSource("pages/home.tsx");

  assert.match(source, /data-testid="home-scroll-container"/);
  assert.match(source, /h-screen/);
  assert.match(source, /h-dvh/);
  assert.match(source, /min-h-0/);
  assert.match(source, /overflow-x-hidden/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /overscroll-y-contain/);
  assert.match(source, /<header[^>]+sticky top-0/s);
  assert.match(source, /href="#how-it-works"/);
  assert.match(source, /id="how-it-works"/);
  assert.match(source, /<PageFooter\s*\/>/);
});

test("Broker API keeps its scroll-container marker", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(source, /<AuthenticatedPageShell testId="broker-api-scroll-container">/);
});

test("Broker API archived profiles start collapsed and remain expandable without active brokers", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(source, /const \[isArchivedProfilesExpanded, setIsArchivedProfilesExpanded\] = useState\(false\)/);
  assert.match(source, /data-testid="text-archived-broker-count"[\s\S]*?\{archivedBrokerConfigs\.length\}/);
  assert.match(source, /aria-expanded=\{isArchivedProfilesExpanded\}/);
  assert.match(source, /aria-controls="archived-broker-profiles-list"/);
  assert.match(source, /onClick=\{\(\) => setIsArchivedProfilesExpanded\(\(expanded\) => !expanded\)\}/);
  assert.match(source, /id="archived-broker-profiles-list" hidden=\{!isArchivedProfilesExpanded\}/);
  assert.match(source, /activeBrokerConfigs\.length === 0 && archivedBrokerConfigs\.length === 0/);
  assert.match(source, /archivedBrokerConfigs\.length > 0[\s\S]*?<ArchivedBrokerConfigCard/);
});

test("Broker API health cards keep separate Kotak API version visibility", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(source, /status-by-version/);
  assert.match(source, /history-by-version/);
  assert.match(source, /Legacy v2/);
  assert.match(source, /Current v3/);
  assert.match(source, /data-testid=\{`panel-\$\{prefix\}`\}/);
});

test("Broker API shows HSI-parity SFeed diagnostics without exposing feed credentials", async () => {
  const source = await readSource("pages/broker-api.tsx");
  assert.match(source, /function SFeedHealthCard\(\)/);
  assert.match(source, /heartbeatLabel\(feed\.heartbeatStatus\)/);
  assert.match(source, /Last Market Tick/);
  assert.match(source, /Last Disconnected At/);
  assert.match(source, /Reconnect Attempts/);
  assert.match(source, /Connection History/);
  assert.match(source, /Reconnect SFeed/);
  assert.match(source, /Kotak SFeed \(URL hidden\)/);
  assert.match(source, /auto-refreshes every 10s/);
  assert.match(source, /<SFeedHealthCard \/>/);
  assert.doesNotMatch(source, /<VersionedGatewayStatusCard gateway="hsm" \/>/);
});

test("SFeed headings and compact summaries identify saved profiles rather than API versions", async () => {
  const source = await readSource("pages/broker-api.tsx");
  const start = source.indexOf("function SFeedHealthCard()");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const card = source.slice(start, end);
  assert.equal((card.match(/\{feed\.brokerProfileName \|\| "Unnamed Kotak profile"\}/g) ?? []).length, 2);
  assert.doesNotMatch(card, /versionLabel|feed\.apiVersion/);
  assert.match(card, /key=\{feed\.brokerConfigId\}/);
  assert.match(card, /feeds\.length === 0/);
});

test("Scrip Master download uses the safe saved-credential flag", async () => {
  const source = await readSource("pages/broker-api.tsx");
  const cardStart = source.indexOf("function ScripMasterCard(");
  const cardEnd = source.indexOf("\ninterface PFLPlan", cardStart);
  assert.notEqual(cardStart, -1, "ScripMasterCard must exist");
  assert.notEqual(cardEnd, -1, "ScripMasterCard boundary must exist");
  const card = source.slice(cardStart, cardEnd);

  assert.match(card, /kotakConfigs\.find\(c => c\.hasConsumerKey\)/);
  assert.match(card, /disabled=\{isDownloading \|\| !selectedConfig\?\.hasConsumerKey\}/);
  assert.match(card, /!selectedConfig\?\.hasConsumerKey/);
  assert.match(card, /Configure a Kotak Neo broker profile first/);
  assert.doesNotMatch(card, /(?:c|selectedConfig)\??\.consumerKey/);
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