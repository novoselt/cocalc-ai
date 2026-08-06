import {
  moneyToCurrency,
  toDecimal,
  type MoneyValue,
} from "@cocalc/util/money";

const STANDARD_CURRENCY_PRECISION_THRESHOLD = 0.1;

export function formatHourlyRate(rate: MoneyValue): string {
  const value = toDecimal(rate);
  const rounded = value.abs().gte(STANDARD_CURRENCY_PRECISION_THRESHOLD)
    ? value.toDecimalPlaces(2)
    : value.toSignificantDigits(2);
  const decimalPlaces = value.abs().gte(STANDARD_CURRENCY_PRECISION_THRESHOLD)
    ? 2
    : Math.max(2, rounded.decimalPlaces());
  return `${moneyToCurrency(rounded, decimalPlaces)}/hour`;
}
