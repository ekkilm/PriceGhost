/**
 * Format price with appropriate currency symbol
 */
export function formatPrice(price: number | string | null, currency: string | null): string {
  if (price === null || price === undefined) return 'N/A';

  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return 'N/A';

  const symbol = getCurrencySymbol(currency);
  const formatted = numPrice.toFixed(2);

  // For currencies with prefix symbols
  if (['$', '€', '£', '₹', '¥', 'Fr.'].includes(symbol)) {
    return `${symbol}${formatted}`;
  }

  // For currencies with suffix (CHF, CAD, AUD)
  return `${formatted} ${symbol}`;
}

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(currency: string | null): string {
  if (!currency) return '$';

  const currencyMap: Record<string, string> = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CNY': '¥',
    'INR': '₹',
    'CHF': 'CHF',
    'CAD': 'CAD',
    'AUD': 'AUD',
    'NZD': 'NZD',
    'SEK': 'SEK',
    'NOK': 'NOK',
    'DKK': 'DKK',
    'PLN': 'PLN',
    'CZK': 'CZK',
    'HUF': 'HUF',
    'RON': 'RON',
    'BGN': 'BGN',
    'HRK': 'HRK',
    'RUB': '₽',
    'TRY': '₺',
    'BRL': 'R$',
    'MXN': 'MX$',
    'ARS': 'ARS',
    'CLP': 'CLP',
    'COP': 'COP',
    'PEN': 'PEN',
    'ZAR': 'ZAR',
    'KRW': '₩',
    'THB': '฿',
    'VND': '₫',
    'IDR': 'IDR',
    'MYR': 'MYR',
    'SGD': 'SGD',
    'PHP': '₱',
    'HKD': 'HK$',
    'TWD': 'NT$',
    'ILS': '₪',
    'SAR': 'SAR',
    'AED': 'AED',
    'EGP': 'EGP',
  };

  return currencyMap[currency.toUpperCase()] || currency.toUpperCase();
}

/**
 * Format currency code for display (e.g., "USD" → "US Dollar")
 */
export function getCurrencyName(currency: string | null): string {
  if (!currency) return 'US Dollar';

  const nameMap: Record<string, string> = {
    'USD': 'US Dollar',
    'EUR': 'Euro',
    'GBP': 'British Pound',
    'JPY': 'Japanese Yen',
    'CNY': 'Chinese Yuan',
    'INR': 'Indian Rupee',
    'CHF': 'Swiss Franc',
    'CAD': 'Canadian Dollar',
    'AUD': 'Australian Dollar',
    'NZD': 'New Zealand Dollar',
    'SEK': 'Swedish Krona',
    'NOK': 'Norwegian Krone',
    'DKK': 'Danish Krone',
    'RUB': 'Russian Ruble',
    'BRL': 'Brazilian Real',
    'MXN': 'Mexican Peso',
    'ZAR': 'South African Rand',
    'KRW': 'South Korean Won',
    'SGD': 'Singapore Dollar',
    'HKD': 'Hong Kong Dollar',
  };

  return nameMap[currency.toUpperCase()] || currency.toUpperCase();
}