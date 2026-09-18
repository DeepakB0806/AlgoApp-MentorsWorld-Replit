import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appSourcePath = join(here, "..", "src", "App.tsx");

export async function getProtectedRouteInventory() {
  const source = await readFile(appSourcePath, "utf8");
  const lazyPages = new Map(
    [...source.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\("@\/pages\/([^"]+)"\)\)/g)]
      .map(([, componentName, pageName]) => [componentName, `${pageName}.tsx`]),
  );
  const routes = [...source.matchAll(/path:\s*"(\/[^"]+)"\s*,\s*page:\s*(\w+)/g)]
    .map(([, path, componentName]) => ({
      path,
      pageFile: lazyPages.get(componentName),
      componentName,
    }));

  if (routes.length === 0) {
    throw new Error("No protected routes found in App.tsx");
  }

  const unresolved = routes.filter((route) => !route.pageFile);
  if (unresolved.length > 0) {
    throw new Error(
      `Protected routes reference unknown lazy pages: ${unresolved.map((route) => route.componentName).join(", ")}`,
    );
  }

  return routes;
}