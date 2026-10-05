import assert from "node:assert/strict";
import test from "node:test";
import { invokeCallbackSafely } from "../src/invoke-callback-safely";

test("invokeCallbackSafely runs a callback without reporting an error", () => {
  let calls = 0;
  const errors: unknown[] = [];

  invokeCallbackSafely(
    () => { calls++; },
    error => errors.push(error),
  );

  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
});

test("invokeCallbackSafely contains callback exceptions and reports them", () => {
  const callbackError = new Error("callback failed");
  const errors: unknown[] = [];

  assert.doesNotThrow(() => invokeCallbackSafely(
    () => { throw callbackError; },
    error => errors.push(error),
  ));

  assert.deepEqual(errors, [callbackError]);
});

test("invokeCallbackSafely ignores an absent callback", () => {
  const errors: unknown[] = [];

  invokeCallbackSafely(undefined, error => errors.push(error));

  assert.deepEqual(errors, []);
});
