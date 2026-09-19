import assert from "node:assert/strict";
import test from "node:test";
import {
  getKotakApiProfileInfo,
  normalizeKotakApiVersion,
  validateV3Order,
} from "../src/kotak-api-adapter";

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