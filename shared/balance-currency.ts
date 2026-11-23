import { formatCAD } from "./fees";

export const BALANCE_CURRENCIES = [
  "CAD",
  "GBP",
  "USD",
  "EUR",
  "CHF",
  "AUD",
  "JPY",
  "SGD",
  "HKD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "AED",
  "INR",
  "ZAR",
  "MXN",
  "BRL",
] as const;

export type BalanceCurrency = (typeof BALANCE_CURRENCIES)[number];

export type BalanceCurrencyMeta = {
  code: BalanceCurrency;
  name: string;
  symbol: string;
  locale: string;
};

export const BALANCE_CURRENCY_INFO: Record<BalanceCurrency, BalanceCurrencyMeta> = {
  CAD: { code: "CAD", name: "Canadian Dollar", symbol: "CAD $", locale: "en-CA" },
  GBP: { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB" },
  USD: { code: "USD", name: "US Dollar", symbol: "US$", locale: "en-CA" },
  EUR: { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE" },
  CHF: { code: "CHF", name: "Swiss Franc", symbol: "CHF", locale: "en-US" },
  AUD: { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-US" },
  JPY: { code: "JPY", name: "Japanese Yen", symbol: "¥", locale: "en-US" },
  SGD: { code: "SGD", name: "Singapore Dollar", symbol: "S$", locale: "en-US" },
  HKD: { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", locale: "en-US" },
  NZD: { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", locale: "en-US" },
  SEK: { code: "SEK", name: "Swedish Krona", symbol: "SEK", locale: "en-US" },
  NOK: { code: "NOK", name: "Norwegian Krone", symbol: "NOK", locale: "en-US" },
  DKK: { code: "DKK", name: "Danish Krone", symbol: "DKK", locale: "en-US" },
  AED: { code: "AED", name: "UAE Dirham", symbol: "AED", locale: "en-US" },
  INR: { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-US" },
  ZAR: { code: "ZAR", name: "South African Rand", symbol: "ZAR", locale: "en-US" },
  MXN: { code: "MXN", name: "Mexican Peso", symbol: "MX$", locale: "en-US" },
  BRL: { code: "BRL", name: "Brazilian Real", symbol: "R$", locale: "en-US" },
};

const BALANCE_CURRENCY_SET = new Set<string>(BALANCE_CURRENCIES);
const CURRENCY_TOKEN_REGEX = new RegExp(
  `\\b(?:${BALANCE_CURRENCIES.join("|")})\\b`,
  "g",
);

export function isBalanceCurrency(value: unknown): value is BalanceCurrency {
  return typeof value === "string" && BALANCE_CURRENCY_SET.has(value);
}

// A presentation preference only: never converts or rewrites ledger amounts.
export function clientBalanceCurrency(user?: { displayCurrency?: string | null } | null): BalanceCurrency {
  if (!user?.displayCurrency) return "CAD";
  if (isBalanceCurrency(user.displayCurrency)) return user.displayCurrency;
  throw new Error("Unsupported balance display currency");
}

export function balanceCurrencyLabel(currency: BalanceCurrency): string {
  if (currency === "GBP") return "£";
  if (currency === "CAD") return "CAD";
  return currency;
}

// Nominal display only; original pricing/audit records remain unchanged.
export function balanceText(text: string | null | undefined, currency: BalanceCurrency): string {
  if (currency === "CAD") return text || "";
  const replacement = balanceCurrencyLabel(currency);
  return (text || "").replace(CURRENCY_TOKEN_REGEX, replacement);
}

// Clean only the known generated fee format, never arbitrary references or dates.
// This is presentation only: the original assessment/audit description stays stored.
export function transactionDescription(text: string | null | undefined, currency: BalanceCurrency, transactionType?: string): string {
  const generatedFee = (text || "").match(
    /^\s*(?:(?:CAD|GBP|USD|EUR|CHF|AUD|JPY|SGD|HKD|NZD|SEK|NOK|DKK|AED|INR|ZAR|MXN|BRL|£|€|¥|₹)\s+)?(monthly service fee|annual discretionary-management fee|annual management fee)( refund)?(?:\s*·\s*(?:\d{4}-\d{2}-\d{2}\s*·\s*)?Assessment \d+(?:\s*·\s*(?:Authorized fee overdraft|Available cash))?)?\s*$/i,
  );
  if (generatedFee && (transactionType === undefined || transactionType === "fee" || transactionType === "fee_refund")) {
    const label = /^monthly/i.test(generatedFee[1]) ? "Monthly service fee" : "Annual management fee";
    return `${label}${generatedFee[2] ? " refund" : ""}`;
  }
  const presented = balanceText(text, currency);
  if (currency === "GBP") {
    return presented.replace(/^\s*£\s*(?=[A-Za-z])/, "");
  }
  if (currency !== "CAD") {
    return presented.replace(new RegExp(`^\\s*(?:${BALANCE_CURRENCIES.join("|")})\\s+(?=[A-Za-z])`), "");
  }
  return presented;
}

/** Read-only presentation copy; never pass this copy to a financial write. */
export function balancePresentation<T>(value: T, currency: BalanceCurrency): T {
  if (currency === "CAD") return value;
  if (typeof value === "string") return balanceText(value, currency) as T;
  if (Array.isArray(value)) return value.map(item => balancePresentation(item, currency)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, balancePresentation(item, currency)])) as T;
  }
  return value;
}

export function formatBalance(amount: string | number, currency: BalanceCurrency = "CAD"): string {
  if (currency === "CAD") return formatCAD(amount);
  const value = Number(amount);
  if (!Number.isFinite(value)) return "Unavailable";
  if (currency === "GBP") {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  const meta = BALANCE_CURRENCY_INFO[currency] || BALANCE_CURRENCY_INFO.CAD;
  return new Intl.NumberFormat(meta.locale, {
    style: "currency",
    currency: meta.code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
