import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Home, Plus, TrendingUp, TrendingDown, Play, Pause, Trash2, Edit } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Strategy, InsertStrategy } from "@shared/schema";

export default function Strategies() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [formData, setFormData] = useState<Partial<InsertStrategy>>({
    name: "",
    description: "",
    type: "intraday",
    symbol: "",
    exchange: "NSE",
    quantity: 1,
    entryCondition: "",
    exitCondition: "",
    stopLoss: undefined,
    targetProfit: undefined,
    status: "inactive",
  });

  const { data: strategies = [], isLoading } = useQuery<Strategy[]>({
    queryKey: ["/api/strategies"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InsertStrategy>) => {
      return apiRequest("POST", "/api/strategies", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Strategy created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create strategy", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertStrategy> }) => {
      return apiRequest("PATCH", `/api/strategies/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      setIsDialogOpen(false);
      setEditingStrategy(null);
      resetForm();
      toast({ title: "Strategy updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update strategy", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "Strategy deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete strategy", variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/strategies/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      type: "intraday",
      symbol: "",
      exchange: "NSE",
      quantity: 1,
      entryCondition: "",
      exitCondition: "",
      stopLoss: undefined,
      targetProfit: undefined,
      status: "inactive",
    });
  };

  const handleSubmit = () => {
    if (editingStrategy) {
      updateMutation.mutate({ id: editingStrategy.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setFormData({
      name: strategy.name,
      description: strategy.description || "",
      type: strategy.type,
      symbol: strategy.symbol,
      exchange: strategy.exchange,
      quantity: strategy.quantity,
      entryCondition: strategy.entryCondition || "",
      exitCondition: strategy.exitCondition || "",
      stopLoss: strategy.stopLoss || undefined,
      targetProfit: strategy.targetProfit || undefined,
      status: strategy.status,
    });
    setIsDialogOpen(true);
  };

  const handleToggleStatus = (strategy: Strategy) => {
    const newStatus = strategy.status === "active" ? "inactive" : "active";
    toggleStatusMutation.mutate({ id: strategy.id, status: newStatus });
  };

  const getWinRate = (strategy: Strategy) => {
    if (!strategy.totalTrades || strategy.totalTrades === 0) return 0;
    return ((strategy.winningTrades || 0) / strategy.totalTrades * 100).toFixed(1);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-strategies-title">Trading Strategies</h1>
              <p className="text-muted-foreground text-sm">Manage your automated trading strategies</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link href="/">
                <Button variant="outline" size="sm" data-testid="button-home">
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>
              </Link>
              <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) {
                  setEditingStrategy(null);
                  resetForm();
                }
              }}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-strategy">
                    <Plus className="w-4 h-4 mr-2" />
                    New Strategy
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingStrategy ? "Edit Strategy" : "Create New Strategy"}</DialogTitle>
                    <DialogDescription>
                      Configure your trading strategy parameters
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label>Strategy Name</Label>
                        <Input
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          placeholder="My Strategy"
                          data-testid="input-strategy-name"
                        />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select
                          value={formData.type}
                          onValueChange={(value) => setFormData({ ...formData, type: value })}
                        >
                          <SelectTrigger data-testid="select-strategy-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="scalping">Scalping</SelectItem>
                            <SelectItem value="intraday">Intraday</SelectItem>
                            <SelectItem value="swing">Swing Trading</SelectItem>
                            <SelectItem value="positional">Positional</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>Description</Label>
                      <Textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Describe your strategy..."
                        data-testid="input-strategy-description"
                      />
                    </div>

                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <Label>Symbol</Label>
                        <Input
                          value={formData.symbol}
                          onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                          placeholder="RELIANCE"
                          data-testid="input-strategy-symbol"
                        />
                      </div>
                      <div>
                        <Label>Exchange</Label>
                        <Select
                          value={formData.exchange}
                          onValueChange={(value) => setFormData({ ...formData, exchange: value })}
                        >
                          <SelectTrigger data-testid="select-strategy-exchange">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NSE">NSE</SelectItem>
                            <SelectItem value="BSE">BSE</SelectItem>
                            <SelectItem value="NFO">NFO</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={formData.quantity}
                          onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                          data-testid="input-strategy-quantity"
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label>Entry Condition</Label>
                        <Textarea
                          value={formData.entryCondition}
                          onChange={(e) => setFormData({ ...formData, entryCondition: e.target.value })}
                          placeholder="When to enter the trade..."
                          data-testid="input-entry-condition"
                        />
                      </div>
                      <div>
                        <Label>Exit Condition</Label>
                        <Textarea
                          value={formData.exitCondition}
                          onChange={(e) => setFormData({ ...formData, exitCondition: e.target.value })}
                          placeholder="When to exit the trade..."
                          data-testid="input-exit-condition"
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label>Stop Loss (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={formData.stopLoss || ""}
                          onChange={(e) => setFormData({ ...formData, stopLoss: parseFloat(e.target.value) || undefined })}
                          placeholder="2.0"
                          data-testid="input-stop-loss"
                        />
                      </div>
                      <div>
                        <Label>Target Profit (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={formData.targetProfit || ""}
                          onChange={(e) => setFormData({ ...formData, targetProfit: parseFloat(e.target.value) || undefined })}
                          placeholder="5.0"
                          data-testid="input-target-profit"
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleSubmit}
                      disabled={!formData.name || !formData.symbol || createMutation.isPending || updateMutation.isPending}
                      data-testid="button-save-strategy"
                    >
                      {createMutation.isPending || updateMutation.isPending ? "Saving..." : (editingStrategy ? "Update Strategy" : "Create Strategy")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : strategies.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Strategies Yet</h3>
              <p className="text-muted-foreground mb-4">Create your first trading strategy to get started</p>
              <Button onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-strategy">
                <Plus className="w-4 h-4 mr-2" />
                Create Strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {strategies.map((strategy) => (
              <Card key={strategy.id} data-testid={`card-strategy-${strategy.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-4 flex-wrap">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {strategy.name}
                        <Badge variant={strategy.status === "active" ? "default" : "secondary"}>
                          {strategy.status}
                        </Badge>
                        <Badge variant="outline">{strategy.type}</Badge>
                      </CardTitle>
                      <CardDescription>{strategy.description || "No description"}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={strategy.status === "active"}
                        onCheckedChange={() => handleToggleStatus(strategy)}
                        data-testid={`switch-strategy-${strategy.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(strategy)}
                        data-testid={`button-edit-${strategy.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(strategy.id)}
                        data-testid={`button-delete-${strategy.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Symbol</p>
                      <p className="font-medium">{strategy.symbol} ({strategy.exchange})</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quantity</p>
                      <p className="font-medium">{strategy.quantity}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Trades</p>
                      <p className="font-medium">{strategy.totalTrades || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Win Rate</p>
                      <p className="font-medium">{getWinRate(strategy)}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">P&L</p>
                      <p className={`font-medium ${(strategy.profitLoss || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                        ₹{(strategy.profitLoss || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
