import test from "node:test";
import assert from "node:assert/strict";
import { decodeNativeBatch } from "../src/kotak-native-feed";

function miniTouchLine(): Buffer {
  const packet = Buffer.alloc(54);
  packet.writeUInt16LE(54, 0);
  packet.writeUInt16LE(7208, 2);
  packet.writeInt8(1, 4); // nse_cm
  packet.writeUInt8(1, 5); // mini touchline
  packet.writeUInt32LE(11536, 9);
  packet.writeUInt32LE(123456, 21);
  return packet;
}

test("decodes Kotak's worked mini-touchline example with exchange divider", () => {
  const dividers = new Map([["nse_cm", 100]]);
  const symbols = new Map([["nse_cm|11536", "SAMPLE"]]);
  const result = decodeNativeBatch(miniTouchLine(), dividers, symbols);
  assert.deepEqual(result, [{ symbol: "SAMPLE", ltp: 1234.56, exchange: "nse_cm", token: "11536" }]);
});

test("skips a truncated batch packet rather than reading beyond its declared length", () => {
  const packet = miniTouchLine().subarray(0, 30);
  const result = decodeNativeBatch(packet, new Map([["nse_cm", 100]]), new Map([["nse_cm|11536", "SAMPLE"]]));
  assert.deepEqual(result, []);
});

test("decodes adjacent packets in one native batch frame", () => {
  const first = miniTouchLine();
  const second = miniTouchLine();
  second.writeUInt32LE(222, 9);
  const result = decodeNativeBatch(Buffer.concat([first, second]), new Map([["nse_cm", 100]]), new Map([
    ["nse_cm|11536", "FIRST"],
    ["nse_cm|222", "SECOND"],
  ]));
  assert.deepEqual(result.map((tick) => tick.symbol), ["FIRST", "SECOND"]);
});
