import { expect, test } from "bun:test";
import { applyDiscount, orderTotal } from "../src/price.ts";

test("applyDiscount removes the percentage", () => {
  expect(applyDiscount(1000, 10)).toBe(900);
});

test("applyDiscount rejects out of range percentages", () => {
  expect(() => applyDiscount(1000, 101)).toThrow();
});

test("orderTotal sums unit price times quantity", () => {
  expect(orderTotal([{ unit: 250, qty: 2 }, { unit: 100, qty: 1 }])).toBe(600);
});
