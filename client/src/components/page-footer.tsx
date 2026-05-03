import { TrendingUp } from "lucide-react";

export function PageFooter() {
  return (
    <footer className="border-t border-border py-8 mt-8">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <TrendingUp className="w-2 h-2 text-primary" />
            </div>
            <span className="font-semibold text-foreground">Copyright @ MentorsWorld Ventures Pvt. Ltd.</span>
          </div>
          <p className="text-muted-foreground text-sm" data-testid="text-footer">
            Automated Trading Made Simple, Seamless, Secured, &amp; Profitable
          </p>
        </div>
      </div>
    </footer>
  );
}
