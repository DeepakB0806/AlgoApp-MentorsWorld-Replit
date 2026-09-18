import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthenticatedPageShellProps {
  children: ReactNode;
  testId?: string;
}

export function AuthenticatedPageShell({ children, testId }: AuthenticatedPageShellProps) {
  return (
    <div
      className={cn("h-screen h-dvh min-h-0 w-full overflow-y-auto overscroll-y-contain bg-background")}
      data-testid={testId ?? "authenticated-page-shell"}
    >
      {children}
    </div>
  );
}