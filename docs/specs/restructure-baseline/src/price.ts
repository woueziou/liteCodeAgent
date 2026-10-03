/** Prices are integer cents. */
export type Cents = number;

/** Applies a percentage discount (0-100) to a price in cents. */
export function applyDiscount(price: Cents, percent: number): Cents {
  if (percent < 0 || percent > 100) throw new Error("percent must be between 0 and 100");
  return Math.floor(price - (price * percent) / 100);
}

/** Sums line items (unit price in cents times quantity). */
export function orderTotal(lines: { unit: Cents; qty: number }[]): Cents {
  return lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
}
