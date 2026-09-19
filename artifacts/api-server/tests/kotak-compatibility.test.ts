import assert from "node:assert/strict";
import test from "node:test";
import {
  getKotakApiProfileInfo,
  normalizeKotakApiVersion,
  validateV3Order,
} from "../src/kotak-api-adapter";
import { getHsiStatuses } from "../src/hsi-kotak-neo-v3";
import { getHsmStatuses } from "../src/hsm-kotak-neo-v3";
import type { BrokerConfig } from "@workspace/db";

function connectedKotakConfig(apiVersion: "v2_legacy" | "v3_current", id: string): BrokerConfig {
  return {
    id,
    brokerName: "kotak_neo",
    apiVersion,
    isConnected: true,
  } as BrokerConfig;
}

test("unknown broker profiles fail safe to the legacy contract", () => {
  assert.equal(normalizeKotakApiVersion(undefined), "v2_legacy");
  assert.equal(normalizeKotakApiVersion("removed_profile"), "v2_legacy");
  assert.equal(getKotakApiProfileInfo(undefined).value, "v2_legacy");
});

test("v3 accepts canonical option order values", () => {
  assert.equal(validateV3Order({
    exchange: "nse_fo",
    productType: "NRML",
    priceType: "MKT",
    validity: "DAY",
    quantity: 50,
    price: 0,
  }, "place"), null);
});

test("v3 rejects unsupported order values before broker dispatch", () => {
  assert.match(
    validateV3Order({
      exchange: "nse_fo",
      productType: "BO",
      priceType: "MKT",
      validity: "DAY",
      quantity: 50,
      price: 0,
    }, "place") ?? "",
    /product "BO"/,
  );

  assert.match(
    validateV3Order({
      exchange: "nse_fo",
      productType: "NRML",
      priceType: "L",
      validity: "DAY",
      quantity: 50,
      price: 0,
    }, "place") ?? "",
    /positive price/,
  );
});

test("versioned HSI and HSM status expose both profiles without cross-reporting", () => {
  const statuses = getHsiStatuses([connectedKotakConfig("v2_legacy", "legacy-config")]);
  assert.deepEqual(statuses.map(status => status.apiVersion), ["v2_legacy", "v3_current"]);
  assert.equal(statuses[0].apiVersionLabel, "Legacy v2");
  assert.equal(statuses[0].lifecycle, "not_running");
  assert.equal(statuses[0].configuredCount, 1);
  assert.equal(statuses[1].apiVersionLabel, "Current v3");
  assert.equal(statuses[1].lifecycle, "not_configured");
  assert.equal(statuses[1].connected, false);

  const hsmStatuses = getHsmStatuses([connectedKotakConfig("v2_legacy", "legacy-config")]);
  assert.deepEqual(hsmStatuses.map(status => status.apiVersion), ["v2_legacy", "v3_current"]);
  assert.equal(hsmStatuses[0].lifecycle, "not_running");
  assert.equal(hsmStatuses[0].configuredCount, 1);
  assert.equal(hsmStatuses[1].lifecycle, "not_configured");
  assert.equal(hsmStatuses[1].connected, false);
});

test("versioned status distinguishes configured but stopped profiles", () => {
  const configs = [
    connectedKotakConfig("v2_legacy", "legacy-config"),
    connectedKotakConfig("v3_current", "current-config"),
  ];

  assert.deepEqual(
    getHsiStatuses(configs).map(status => status.lifecycle),
    ["not_running", "not_running"],
  );
  assert.deepEqual(
    getHsmStatuses(configs).map(status => status.lifecycle),
    ["not_running", "not_running"],
  );
});