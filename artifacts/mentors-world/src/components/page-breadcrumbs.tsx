import { Link } from "wouter";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface BreadcrumbEntry {
  label: string;
  href?: string;
}

interface PageBreadcrumbsProps {
  items: BreadcrumbEntry[];
}

export function PageBreadcrumbs({ items }: PageBreadcrumbsProps) {
  return (
    <Breadcrumb data-testid="breadcrumb-nav">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/user-home" data-testid="breadcrumb-home">
              <Home className="w-3.5 h-3.5" />
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <span key={item.label} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast || !item.href ? (
                  <BreadcrumbPage data-testid={`breadcrumb-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={item.href} data-testid={`breadcrumb-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
