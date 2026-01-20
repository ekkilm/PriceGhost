import axios from 'axios';
import { load, type CheerioAPI } from 'cheerio';
import {
  parsePrice,
  ParsedPrice,
  findMostLikelyPrice,
} from '../utils/priceParser';

export interface ScrapedProduct {
  name: string | null;
  price: ParsedPrice | null;
  imageUrl: string | null;
  url: string;
}

// Common price selectors used across e-commerce sites
const priceSelectors = [
  // Schema.org
  '[itemprop="price"]',
  '[data-price]',
  '[data-product-price]',

  // Common class names
  '.price',
  '.product-price',
  '.current-price',
  '.sale-price',
  '.final-price',
  '.offer-price',
  '#price',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#priceblock_saleprice',

  // Amazon specific
  '.a-price .a-offscreen',
  '.a-price-whole',
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',

  // Generic patterns
  '[class*="price"]',
  '[class*="Price"]',
  '[id*="price"]',
  '[id*="Price"]',
];

// Selectors for product name
const nameSelectors = [
  '[itemprop="name"]',
  'h1[class*="product"]',
  'h1[class*="title"]',
  '#productTitle',
  '.product-title',
  '.product-name',
  'h1',
];

// Selectors for product image
const imageSelectors = [
  '[itemprop="image"]',
  '[property="og:image"]',
  '#landingImage',
  '#imgBlkFront',
  '.product-image img',
  '.main-image img',
  '[data-zoom-image]',
  'img[class*="product"]',
];

export async function scrapeProduct(url: string): Promise<ScrapedProduct> {
  const result: ScrapedProduct = {
    name: null,
    price: null,
    imageUrl: null,
    url,
  };

  try {
    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const $ = load(response.data);

    // Try to extract from JSON-LD structured data first
    const jsonLdData = extractJsonLd($);
    if (jsonLdData) {
      if (jsonLdData.name) result.name = jsonLdData.name;
      if (jsonLdData.price) result.price = jsonLdData.price;
      if (jsonLdData.image) result.imageUrl = jsonLdData.image;
    }

    // Extract product name
    if (!result.name) {
      result.name = extractName($);
    }

    // Extract price
    if (!result.price) {
      result.price = extractPrice($);
    }

    // Extract image
    if (!result.imageUrl) {
      result.imageUrl = extractImage($, url);
    }

    // Try Open Graph meta tags as fallback
    if (!result.name) {
      result.name = $('meta[property="og:title"]').attr('content') || null;
    }
    if (!result.imageUrl) {
      result.imageUrl = $('meta[property="og:image"]').attr('content') || null;
    }
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
  }

  return result;
}

interface JsonLdProduct {
  '@type'?: string;
  '@graph'?: JsonLdProduct[];
  name?: string;
  image?: string | string[] | { url?: string };
  offers?: JsonLdOffer | JsonLdOffer[];
}

interface JsonLdOffer {
  price?: string | number;
  priceCurrency?: string;
}

function extractJsonLd(
  $: CheerioAPI
): { name?: string; price?: ParsedPrice; image?: string } | null {
  try {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      const content = $(scripts[i]).html();
      if (!content) continue;

      const data = JSON.parse(content) as JsonLdProduct | JsonLdProduct[];
      const product = findProduct(data);

      if (product) {
        const result: { name?: string; price?: ParsedPrice; image?: string } =
          {};

        if (product.name) {
          result.name = product.name;
        }

        if (product.offers) {
          const offer = Array.isArray(product.offers)
            ? product.offers[0]
            : product.offers;
          if (offer && offer.price) {
            result.price = {
              price: parseFloat(String(offer.price)),
              currency: offer.priceCurrency || 'USD',
            };
          }
        }

        if (product.image) {
          if (Array.isArray(product.image)) {
            result.image = product.image[0];
          } else if (typeof product.image === 'string') {
            result.image = product.image;
          } else if (product.image.url) {
            result.image = product.image.url;
          }
        }

        return result;
      }
    }
  } catch (_e) {
    // JSON parse error, continue with other methods
  }
  return null;
}

function findProduct(data: JsonLdProduct | JsonLdProduct[]): JsonLdProduct | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }

  if (data['@type'] === 'Product') {
    return data;
  }

  if (data['@graph'] && Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      const found = findProduct(item);
      if (found) return found;
    }
  }

  return null;
}

function extractPrice($: CheerioAPI): ParsedPrice | null {
  const prices: ParsedPrice[] = [];

  for (const selector of priceSelectors) {
    const elements = $(selector);
    elements.each((_, el) => {
      const text =
        $(el).attr('content') || $(el).attr('data-price') || $(el).text();
      const parsed = parsePrice(text);
      if (parsed) {
        prices.push(parsed);
      }
    });

    if (prices.length > 0) break;
  }

  return findMostLikelyPrice(prices);
}

function extractName($: CheerioAPI): string | null {
  for (const selector of nameSelectors) {
    const element = $(selector).first();
    if (element.length) {
      const text = element.text().trim();
      if (text && text.length > 0 && text.length < 500) {
        return text;
      }
    }
  }
  return null;
}

function extractImage($: CheerioAPI, baseUrl: string): string | null {
  for (const selector of imageSelectors) {
    const element = $(selector).first();
    if (element.length) {
      const src =
        element.attr('src') ||
        element.attr('content') ||
        element.attr('data-zoom-image') ||
        element.attr('data-src');
      if (src) {
        // Handle relative URLs
        try {
          return new URL(src, baseUrl).href;
        } catch (_e) {
          return src;
        }
      }
    }
  }
  return null;
}

export async function scrapePrice(url: string): Promise<ParsedPrice | null> {
  const product = await scrapeProduct(url);
  return product.price;
}
