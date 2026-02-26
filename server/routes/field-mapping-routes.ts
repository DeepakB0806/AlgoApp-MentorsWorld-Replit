import type { Express } from "express";
import type { IStorage } from "../storage";

const UNIVERSAL_FIELD_MAP: Record<string, string> = {
  ts: "tradingSymbol", es: "exchange", tt: "transactionType", qt: "quantity",
  pr: "price", pt: "orderType", pc: "productType", rt: "validity", tp: "triggerPrice",
  am: "afterMarketOrder", dq: "disclosedQuantity", mp: "marketProtection", pf: "priceFlag",
  no: "orderNo", on: "orderNo", vd: "validity",
  mobileNumber: "mobileNumber", ucc: "ucc", totp: "totp", mpin: "mpin",
  holdQty: "holdingQuantity", avgPrc: "averagePrice", dispSym: "displaySymbolAlt",
  brkName: "brokerName", brnchId: "branchId",
  exch: "exchange", seg: "segment", exchange: "exchange", token: "token",
  optType: "optionType", strikePrice: "strikePrice",
  instrumentType: "instrumentType", sector: "sector", instrumentToken: "instrumentToken",
  commonScripCode: "scripCode", instrumentName: "instrumentName",
  quantity: "quantity", averagePrice: "averagePrice", holdingCost: "investedValue",
  closingPrice: "closingPrice", mktValue: "marketValue",
  scripId: "scripId", isAlternateScrip: "isAlternateScrip",
  unrealisedGainLoss: "unrealisedPnl", sqGainLoss: "squareOffPnl", delGainLoss: "deliveryPnl",
  subTotal: "subTotal", prevDayLtp: "prevDayLtp", subType: "subType",
  instrumentStatus: "instrumentStatus", marketLot: "marketLot",
  expiryDate: "expiryDate",
  symbol: "symbol", displaySymbol: "displaySymbol",
  exchangeSegment: "exchange", series: "series",
  exchangeIdentifier: "exchangeIdentifier", sellableQuantity: "sellableQuantity",
  securityType: "securityType", securitySubType: "securitySubType",
  logoUrl: "logoUrl", cmotCode: "cmotCode",
  trdSym: "tradingSymbol", exSeg: "exchange", flBuyQty: "buyQuantity",
  flSellQty: "sellQuantity", buyAmt: "buyAmount", sellAmt: "sellAmount",
  mtm: "mtmPnl", ltp: "lastTradedPrice", prod: "productType",
  optTp: "optionType", stkPrc: "strikePrice", exDt: "expiryDate",
  realisedprofitloss: "realisedPnl", unrealisedprofitloss: "unrealisedPnl",
  tok: "token",
  nOrdNo: "orderNo", trnsTp: "transactionType", qty: "quantity",
  prc: "price", ordSt: "orderStatus", prcTp: "priceType",
  ordDtTm: "orderTimestamp",
  actId: "accountId", brdLtQty: "boardLotQty", cfBuyAmt: "cfBuyAmount",
  cfSellAmt: "cfSellAmount", cfBuyQty: "cfBuyQuantity", cfSellQty: "cfSellQuantity",
  type: "positionType", sym: "symbol", sqrFlg: "squareOffFlag", posFlg: "positionFlag",
  lotSz: "lotSize", multiplier: "multiplier", precision: "precision",
  prcNum: "priceNumerator", prcDen: "priceDenominator", hsUpTm: "lastUpdateTime",
  expDt: "expiryDate", exp: "expiryDisplay", genNum: "genNumerator",
  genDen: "genDenominator", dscQty: "disclosedQuantity", upldPrc: "uploadPrice",
  updRecvTm: "updateReceivedTime",
  algId: "algoId", algCat: "algoCategory", algSeqNo: "algoSeqNo",
  brkClnt: "brokerClient", cnlQty: "cancelledQuantity", coPct: "coverOrderPct",
  defMktProV: "defaultMktProtectionValue", dscQtyPct: "disclosedQtyPct",
  exUsrInfo: "exchangeUserInfo", exCfmTm: "exchangeConfirmTime",
  exOrdId: "exchangeOrderId", expDtSsb: "expiryDateSsb",
  fldQty: "filledQuantity", boeSec: "boeSeconds",
  mktProPct: "mktProtectionPct", mktPro: "mktProtection",
  mfdBy: "modifiedBy", minQty: "minQuantity",
  mktProFlg: "mktProtectionFlag", noMktProFlg: "noMktProtectionFlag",
  ordAutSt: "orderAutoStatus", odCrt: "orderCreate",
  ordEntTm: "orderEntryTime", ordGenTp: "orderGenType",
  ordSrc: "orderSource", ordValDt: "orderValidityDate",
  refLmtPrc: "refLimitPrice", rejRsn: "rejectionReason",
  rmk: "remarks", rptTp: "reportType", reqId: "requestId",
  sipInd: "sipIndicator", stat: "status",
  symOrdId: "symbolOrderId", tckSz: "tickSize",
  trgPrc: "triggerPrice", unFldSz: "unfilledSize",
  usrId: "userId", uSec: "userSeconds", vldt: "validity",
  classification: "classification", vendorCode: "vendorCode",
  GuiOrdId: "guiOrderId", locId: "locationId",
  appInstlId: "appInstallId", ordModNo: "orderModificationNo",
  strategyCode: "strategyCode", it: "instrumentType",
};

export function registerFieldMappingRoutes(app: Express, storage: IStorage) {
  app.post("/api/broker-field-mappings/build", async (req, res) => {
    try {
      const { brokerName, sections } = req.body;
      if (!brokerName || !sections || !Array.isArray(sections)) {
        return res.status(400).json({ error: "brokerName and sections[] required" });
      }

      const fields: any[] = [];
      let sortOrder = 0;

      for (const section of sections) {
        const category = section.key;
        for (const sub of (section.subsections || [])) {
          const endpoint = sub.endpoint || "";
          const direction = endpoint.startsWith("GET") ? "response" : "request";
          for (const f of (sub.fields || [])) {
            const universalName = UNIVERSAL_FIELD_MAP[f.field] || null;
            const matchStatus = universalName ? "matched" : "pending";
            fields.push({
              brokerName,
              category,
              fieldCode: f.field,
              fieldName: f.field,
              fieldType: f.type || "string",
              fieldDescription: f.desc || null,
              direction,
              endpoint: endpoint.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, ""),
              universalFieldName: universalName,
              matchStatus,
              allowedValues: null,
              defaultValue: null,
              isRequired: false,
              sortOrder: sortOrder++,
              notes: null,
            });
          }
        }
      }

      await storage.deleteBrokerFieldMappings(brokerName);
      const results = await storage.upsertBrokerFieldMappings(fields);
      const stats = await storage.getBrokerFieldMappingStats(brokerName);

      res.json({
        success: true,
        total: results.length,
        stats,
        fields: results,
      });
    } catch (error) {
      console.error("Failed to build broker field mappings:", error);
      res.status(500).json({ error: "Failed to build broker field mappings" });
    }
  });

  app.get("/api/broker-field-mappings/:brokerName", async (req, res) => {
    try {
      const { category } = req.query;
      const fields = await storage.getBrokerFieldMappings(req.params.brokerName, category as string | undefined);
      res.json(fields);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker field mappings" });
    }
  });

  app.get("/api/broker-field-mappings/:brokerName/stats", async (req, res) => {
    try {
      const stats = await storage.getBrokerFieldMappingStats(req.params.brokerName);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch broker field mapping stats" });
    }
  });

  app.patch("/api/broker-field-mappings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const updated = await storage.updateBrokerFieldMapping(id, req.body);
      if (!updated) return res.status(404).json({ error: "Mapping not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update broker field mapping" });
    }
  });
}
