import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { MotherConfigurator } from "@/components/strategy-config";
import { TradePlanning } from "@/components/trade-planning";
import { BrokerLinking } from "@/components/broker-linking";

export default function Strategies() {
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
        <Tabs defaultValue="configurator" data-testid="tabs-strategy">
          <TabsList className="mb-6" data-testid="tabslist-strategy">
            <TabsTrigger value="configurator" data-testid="tab-configurator">Mother Configurator</TabsTrigger>
            <TabsTrigger value="planning" data-testid="tab-planning">Trade Planning</TabsTrigger>
            <TabsTrigger value="broker" data-testid="tab-broker">Broker Linking</TabsTrigger>
          </TabsList>
          <TabsContent value="configurator">
            <MotherConfigurator />
          </TabsContent>
          <TabsContent value="planning">
            <TradePlanning />
          </TabsContent>
          <TabsContent value="broker">
            <BrokerLinking />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
