import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthenticatedPageShellProps {
  children: ReactNode;
  testId?: string;
}

export function AuthenticatedPageShell({ children, testId }: AuthenticatedPageShellProps) {
  return (
    <div
      className={cn("min-h-screen overflow-y-auto overscroll-y-contain bg-background")}
      data-testid={testId}
    >
      {children}
    </div>
  );
}