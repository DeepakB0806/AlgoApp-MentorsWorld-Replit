import { lazy, Suspense, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Loader2 } from "lucide-react";

const MotherConfigurator = lazy(() => import("@/components/strategy-config").then(m => ({ default: m.MotherConfigurator })));
const TradePlanning = lazy(() => import("@/components/trade-planning").then(m => ({ default: m.TradePlanning })));
const BrokerLinking = lazy(() => import("@/components/broker-linking").then(m => ({ default: m.BrokerLinking })));

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-20" data-testid="tab-loader">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default function Strategies() {
  const [activeTab, setActiveTab] = useState("configurator");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-strategies-title">Strategy Management</h1>
              <p className="text-muted-foreground text-sm">Configure strategies, plans, and broker linking</p>
            </div>
          </div>
          <div className="mt-2">
            <PageBreadcrumbs items={[{ label: "Strategies" }]} />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-strategy">
          <TabsList className="mb-6" data-testid="tabslist-strategy">
            <TabsTrigger value="configurator" data-testid="tab-configurator">Mother Configurator</TabsTrigger>
            <TabsTrigger value="planning" data-testid="tab-planning">Trade Planning</TabsTrigger>
            <TabsTrigger value="broker" data-testid="tab-broker">Broker Linking</TabsTrigger>
          </TabsList>
        </Tabs>

        <Suspense fallback={<TabLoader />}>
          {activeTab === "configurator" && <MotherConfigurator />}
          {activeTab === "planning" && <TradePlanning />}
          {activeTab === "broker" && <BrokerLinking />}
        </Suspense>
      </div>
    </div>
  );
}
