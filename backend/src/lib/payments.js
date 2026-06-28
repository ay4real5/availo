import { randomBytes } from "node:crypto";

/**
 * Payment tokenisation helper.
 *
 * IMPORTANT: This SIMULATES what a PCI-compliant provider (Stripe, Braintree,
 * Adyen) does. In production you would NEVER send the raw card number to your
 * own backend. The browser would send card details directly to the provider's
 * SDK, receive a single-use token, and only that token would reach this server.
 *
 * This module mirrors that contract: it accepts card details ONLY to validate
 * and derive non-sensitive metadata (brand + last4), then discards the PAN/CVC
 * and returns an opaque token. The full card number and CVC are never persisted.
 */

export function luhnValid(number) {
  const digits = String(number).replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function detectBrand(number) {
  const n = String(number).replace(/\D/g, "");
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  if (/^6(011|5)/.test(n)) return "discover";
  return "card";
}

function validExpiry(month, year) {
  const m = Number(month);
  let y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (y < 100) y += 2000; // accept 2-digit years
  if (!Number.isInteger(y)) return false;
  const now = new Date();
  const exp = new Date(y, m, 0, 23, 59, 59); // last day of expiry month
  return exp >= now;
}

/**
 * "Tokenise" a card: validate it and return only safe metadata + an opaque
 * token. Throws an Error with a `.code` for invalid input.
 */
export function tokeniseCard({ number, exp_month, exp_year, cvc, name } = {}) {
  const pan = String(number || "").replace(/\D/g, "");
  if (!luhnValid(pan)) {
    const err = new Error("Invalid card number");
    err.code = "invalid_number";
    throw err;
  }
  if (!validExpiry(exp_month, exp_year)) {
    const err = new Error("Invalid or expired card");
    err.code = "invalid_expiry";
    throw err;
  }
  const cvcStr = String(cvc || "").replace(/\D/g, "");
  if (cvcStr.length < 3 || cvcStr.length > 4) {
    const err = new Error("Invalid CVC");
    err.code = "invalid_cvc";
    throw err;
  }

  let y = Number(exp_year);
  if (y < 100) y += 2000;

  // The opaque token is all the rest of the system ever sees. PAN + CVC are
  // intentionally NOT included and are discarded when this function returns.
  return {
    payment_token: `tok_${randomBytes(16).toString("hex")}`,
    card_brand: detectBrand(pan),
    card_last4: pan.slice(-4),
    card_exp: `${String(Number(exp_month)).padStart(2, "0")}/${String(y).slice(-2)}`,
    card_name: name ? String(name).slice(0, 80) : null,
  };
}
