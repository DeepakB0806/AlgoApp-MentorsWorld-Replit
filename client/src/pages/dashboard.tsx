import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Activity, PlusCircle, RefreshCw, Home } from "lucide-react";
import { Link } from "wouter";
import type { Position, Order, Holding, PortfolioSummary, OrderParams } from "@shared/schema";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("positions");
  const [orderForm, setOrderForm] = useState<OrderParams>({
    exchange_segment: "nse_cm",
    product: "CNC",
    price: "",
    order_type: "L",
    quantity: "",
    validity: "DAY",
    trading_symbol: "",
    transaction_type: "B",
  });

  const { data: positions = [], isLoading: positionsLoading, refetch: refetchPositions } = useQuery<Position[]>({
    queryKey: ["/api/positions"],
  });

  const { data: orders = [], isLoading: ordersLoading, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
  });

  const { data: holdings = [], isLoading: holdingsLoading, refetch: refetchHoldings } = useQuery<Holding[]>({
    queryKey: ["/api/holdings"],
  });

  const { data: portfolioSummary, isLoading: summaryLoading } = useQuery<PortfolioSummary>({
    queryKey: ["/api/portfolio-summary"],
  });

  const handleRefresh = () => {
    refetchPositions();
    refetchOrders();
    refetchHoldings();
  };

  const isLoading = positionsLoading || ordersLoading || holdingsLoading || summaryLoading;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-dashboard-title">Trading Dashboard</h1>
              <p className="text-muted-foreground text-sm">Live trading overview</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link href="/">
                <Button variant="outline" size="sm" data-testid="button-home">
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>
              </Link>
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                disabled={isLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <Card data-testid="card-portfolio-value">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <DollarSign className="w-6 h-6 text-chart-2" />
                <span className="text-2xl font-bold text-foreground">
                  ₹{(portfolioSummary?.totalValue ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-day-pnl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Day P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {(portfolioSummary?.dayPnL ?? 0) >= 0 ? (
                  <TrendingUp className="w-6 h-6 text-primary" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-destructive" />
                )}
                <span className={`text-2xl font-bold ${(portfolioSummary?.dayPnL ?? 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                  ₹{Math.abs(portfolioSummary?.dayPnL ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-total-pnl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {(portfolioSummary?.totalPnL ?? 0) >= 0 ? (
                  <TrendingUp className="w-6 h-6 text-primary" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-destructive" />
                )}
                <span className={`text-2xl font-bold ${(portfolioSummary?.totalPnL ?? 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                  ₹{Math.abs(portfolioSummary?.totalPnL ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-margin">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Available Margin</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Activity className="w-6 h-6 text-chart-3" />
                <span className="text-2xl font-bold text-foreground">
                  ₹{(portfolioSummary?.availableMargin ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-card border border-border" data-testid="tabs-dashboard">
            <TabsTrigger value="positions" data-testid="tab-positions">
              Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-orders">
              Orders ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="holdings" data-testid="tab-holdings">
              Holdings ({holdings.length})
            </TabsTrigger>
            <TabsTrigger value="place-order" data-testid="tab-place-order">
              <PlusCircle className="w-4 h-4 mr-1" />
              Place Order
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <Card>
              <CardHeader>
                <CardTitle>Open Positions</CardTitle>
                <CardDescription>Your current trading positions</CardDescription>
              </CardHeader>
              <CardContent>
                {positions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-positions">No open positions</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Exchange</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Buy Avg</TableHead>
                        <TableHead>LTP</TableHead>
                        <TableHead>P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.map((position, index) => (
                        <TableRow key={index} data-testid={`row-position-${index}`}>
                          <TableCell className="font-medium">{position.trading_symbol}</TableCell>
                          <TableCell>{position.exchange}</TableCell>
                          <TableCell>{position.quantity}</TableCell>
                          <TableCell>₹{position.buy_avg}</TableCell>
                          <TableCell>₹{position.ltp}</TableCell>
                          <TableCell className={position.pnl >= 0 ? "text-primary" : "text-destructive"}>
                            ₹{position.pnl.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <Card>
              <CardHeader>
                <CardTitle>Order Book</CardTitle>
                <CardDescription>Your recent and pending orders</CardDescription>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-orders">No orders found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.order_id} data-testid={`row-order-${order.order_id}`}>
                          <TableCell className="font-medium">{order.trading_symbol}</TableCell>
                          <TableCell>
                            <Badge variant={order.transaction_type === "B" ? "default" : "destructive"}>
                              {order.transaction_type === "B" ? "BUY" : "SELL"}
                            </Badge>
                          </TableCell>
                          <TableCell>{order.quantity}</TableCell>
                          <TableCell>₹{order.price}</TableCell>
                          <TableCell>
                            <Badge variant={order.status === "COMPLETE" ? "default" : "secondary"}>
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{order.timestamp}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="holdings">
            <Card>
              <CardHeader>
                <CardTitle>Holdings</CardTitle>
                <CardDescription>Your long-term investments</CardDescription>
              </CardHeader>
              <CardContent>
                {holdings.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8" data-testid="text-no-holdings">No holdings found</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Avg Price</TableHead>
                        <TableHead>Current Price</TableHead>
                        <TableHead>P&L</TableHead>
                        <TableHead>P&L %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holdings.map((holding, index) => (
                        <TableRow key={index} data-testid={`row-holding-${index}`}>
                          <TableCell className="font-medium">{holding.trading_symbol}</TableCell>
                          <TableCell>{holding.quantity}</TableCell>
                          <TableCell>₹{holding.average_price}</TableCell>
                          <TableCell>₹{holding.current_price}</TableCell>
                          <TableCell className={holding.pnl >= 0 ? "text-primary" : "text-destructive"}>
                            ₹{holding.pnl.toFixed(2)}
                          </TableCell>
                          <TableCell className={holding.pnl_percent >= 0 ? "text-primary" : "text-destructive"}>
                            {holding.pnl_percent.toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="place-order">
            <Card>
              <CardHeader>
                <CardTitle>Place New Order</CardTitle>
                <CardDescription>Enter order details to execute a trade</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Trading Symbol</Label>
                    <Input
                      value={orderForm.trading_symbol}
                      onChange={(e) => setOrderForm({ ...orderForm, trading_symbol: e.target.value })}
                      placeholder="e.g., RELIANCE"
                      data-testid="input-trading-symbol"
                    />
                  </div>

                  <div>
                    <Label>Exchange</Label>
                    <Select
                      value={orderForm.exchange_segment}
                      onValueChange={(value) => setOrderForm({ ...orderForm, exchange_segment: value })}
                    >
                      <SelectTrigger data-testid="select-exchange">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nse_cm">NSE Cash</SelectItem>
                        <SelectItem value="bse_cm">BSE Cash</SelectItem>
                        <SelectItem value="nse_fo">NSE F&O</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Transaction Type</Label>
                    <Select
                      value={orderForm.transaction_type}
                      onValueChange={(value) => setOrderForm({ ...orderForm, transaction_type: value })}
                    >
                      <SelectTrigger data-testid="select-transaction-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="B">Buy</SelectItem>
                        <SelectItem value="S">Sell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Product Type</Label>
                    <Select
                      value={orderForm.product}
                      onValueChange={(value) => setOrderForm({ ...orderForm, product: value })}
                    >
                      <SelectTrigger data-testid="select-product">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                        <SelectItem value="MIS">MIS (Intraday)</SelectItem>
                        <SelectItem value="NRML">NRML (Normal)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Order Type</Label>
                    <Select
                      value={orderForm.order_type}
                      onValueChange={(value) => setOrderForm({ ...orderForm, order_type: value })}
                    >
                      <SelectTrigger data-testid="select-order-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="L">Limit</SelectItem>
                        <SelectItem value="MKT">Market</SelectItem>
                        <SelectItem value="SL">Stop Loss</SelectItem>
                        <SelectItem value="SL-M">Stop Loss Market</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Validity</Label>
                    <Select
                      value={orderForm.validity}
                      onValueChange={(value) => setOrderForm({ ...orderForm, validity: value })}
                    >
                      <SelectTrigger data-testid="select-validity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAY">Day</SelectItem>
                        <SelectItem value="IOC">Immediate or Cancel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={orderForm.quantity}
                      onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                      placeholder="Enter quantity"
                      data-testid="input-quantity"
                    />
                  </div>

                  <div>
                    <Label>Price</Label>
                    <Input
                      type="number"
                      value={orderForm.price}
                      onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                      placeholder="Enter price"
                      disabled={orderForm.order_type === "MKT"}
                      data-testid="input-price"
                    />
                  </div>
                </div>

                <Button
                  className="w-full"
                  disabled={!orderForm.trading_symbol || !orderForm.quantity}
                  data-testid="button-place-order"
                >
                  Place {orderForm.transaction_type === "B" ? "Buy" : "Sell"} Order
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
