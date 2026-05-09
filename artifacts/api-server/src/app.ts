import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";

const app: Express = express();

app.use(cookieParser());

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  let capturedSnippet: string | undefined = undefined;

  const originalResJson = res.json.bind(res);
  res.json = function (bodyJson: any, ...args: any[]) {
    try {
      if (Array.isArray(bodyJson)) {
        capturedSnippet = `[Array(${bodyJson.length})]`;
      } else if (bodyJson && typeof bodyJson === "object") {
        const keys = Object.keys(bodyJson).slice(0, 5).join(",");
        capturedSnippet = `{${keys}}`;
      } else {
        capturedSnippet = String(bodyJson).substring(0, 200);
      }
    } catch {
      capturedSnippet = "[response]";
    }
    return originalResJson(bodyJson, ...args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedSnippet) {
        logLine += ` :: ${capturedSnippet}`;
      }
      log(logLine);
    }
  });

  next();
});

export default app;
