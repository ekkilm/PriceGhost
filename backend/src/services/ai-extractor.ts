import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { load } from 'cheerio';
import { AISettings } from '../models';
import { ParsedPrice } from '../utils/priceParser';
import { StockStatus, PriceCandidate } from './scraper';

// Strip thinking mode tags from model responses (Qwen3, DeepSeek, etc.)
// These models output <think>...</think> blocks before their actual response
function stripThinkingTags(text: string): string {
  // Remove <think>...</think> blocks (including content)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // If nothing left after stripping, return original (in case regex failed)
  return stripped.length > 0 ? stripped : text;
}

export interface AIExtractionResult {
  name: string | null;
  price: ParsedPrice | null;
  imageUrl: string | null;
  stockStatus: StockStatus;
  confidence: number;
}

export interface AIVerificationResult {
  isCorrect: boolean;
  confidence: number;
  suggestedPrice: ParsedPrice | null;
  reason: string;
  stockStatus?: StockStatus;
}

export interface AIStockStatusResult {
  stockStatus: StockStatus;
  confidence: number;
  reason: string;
}

const VERIFICATION_PROMPT = `You are a price and availability verification assistant. I scraped a product page and found a price. Please verify if this price is correct AND if the product is currently available for purchase.

Scraped Price: $SCRAPED_PRICE$ $CURRENCY$

Analyze the HTML content below and determine:
1. Is the scraped price the correct CURRENT/SALE price for the main product?
2. If not, what is the correct price?
3. Is this product currently available for purchase RIGHT NOW?

Common price issues to watch for:
- Scraped price might be a "savings" amount (e.g., "Save $189.99")
- Scraped price might be from a bundle/combo deal section
- Scraped price might be shipping cost or add-on price
- Scraped price might be the original/crossed-out price instead of the sale price

Common availability issues to watch for:
- Product shows "Coming Soon" or "Available [future date]" - NOT in stock
- Product shows "Pre-order" or "Reserve now" - NOT in stock
- Product shows "Notify me when available" or "Sign up for alerts" - NOT in stock
- Product shows "Out of stock" or "Sold out" - NOT in stock
- Product has no "Add to Cart" button but shows a future release date - NOT in stock
- Product CAN be added to cart and purchased today - IN stock

Return a JSON object with:
- isCorrect: boolean - true if the scraped price is correct
- confidence: number from 0 to 1
- suggestedPrice: the correct price as a number (or null if scraped price is correct)
- suggestedCurrency: currency code if suggesting a different price
- stockStatus: MUST be "in_stock" or "out_of_stock" - use "out_of_stock" if the product cannot be purchased RIGHT NOW (including pre-order, coming soon, future availability dates). Only use "unknown" if there is absolutely no availability information on the page.
- reason: brief explanation of your decision (mention both price and availability)

IMPORTANT: If you mention in your reason that the product is "not available", "coming soon", "pre-order", or has a future date, you MUST set stockStatus to "out_of_stock", NOT "unknown".

Only return valid JSON, no explanation text outside the JSON.

HTML Content:
`;

const STOCK_STATUS_PROMPT = `You are an availability verification assistant. The user is tracking a SPECIFIC product variant priced at $VARIANT_PRICE$ $CURRENCY$.

Your task: Determine if THIS SPECIFIC VARIANT (the one at $VARIANT_PRICE$) is currently in stock and can be purchased.

Important context:
- This page may show MULTIPLE variants (sizes, colors, configurations) at DIFFERENT prices
- Some variants may be out of stock while others are in stock
- ONLY report on the variant priced at $VARIANT_PRICE$ - ignore other variants
- If the $VARIANT_PRICE$ variant exists and can be added to cart, it's IN STOCK
- If only other variants are available but not the $VARIANT_PRICE$ one, it's OUT OF STOCK

Signs the $VARIANT_PRICE$ variant is IN STOCK:
- The price $VARIANT_PRICE$ is displayed with an active "Add to Cart" button
- The variant at this price shows "In Stock" or available quantity
- The product at this exact price can be purchased now

Signs the $VARIANT_PRICE$ variant is OUT OF STOCK:
- The $VARIANT_PRICE$ variant shows "Out of Stock", "Unavailable", or "Sold Out"
- Only a "Notify Me" or "Waitlist" button is shown for this variant
- The price exists but the specific variant cannot be added to cart
- A different price is shown as the main purchasable option

Return a JSON object with:
- stockStatus: MUST be "in_stock" or "out_of_stock". Only use "unknown" if there is absolutely no availability information.
- confidence: number from 0 to 1
- reason: brief explanation focusing on the $VARIANT_PRICE$ variant specifically

IMPORTANT: If your reason mentions the product is unavailable, coming soon, pre-order, or has a future date, set stockStatus to "out_of_stock".

Only return valid JSON, no explanation text outside the JSON.

HTML Content:
`;

const EXTRACTION_PROMPT = `You are a price extraction assistant. Analyze the following HTML content from a product page and extract the product information.

Return a JSON object with these fields:
- name: The product name/title (string or null)
- price: The current selling price as a number (not the original/crossed-out price)
- currency: The currency code (USD, EUR, GBP, etc.)
- imageUrl: The main product image URL (string or null)
- stockStatus: One of "in_stock", "out_of_stock", or "unknown"
- confidence: Your confidence in the extraction from 0 to 1

Important:
- Extract the CURRENT/SALE price, not the original price if there's a discount
- If you can't find a price with confidence, set price to null
- Only return valid JSON, no explanation text

HTML Content:
`;

// Truncate HTML to fit within token limits while preserving important content
function prepareHtmlForAI(html: string): string {
  const $ = load(html);

  // Extract JSON-LD data BEFORE removing scripts (it often contains product info)
  const jsonLdScripts: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const scriptContent = $(el).html();
    if (scriptContent) {
      // Include any JSON-LD that might be product-related
      if (scriptContent.includes('price') ||
          scriptContent.includes('Price') ||
          scriptContent.includes('Product') ||
          scriptContent.includes('Offer')) {
        jsonLdScripts.push(scriptContent);
      }
    }
  });

  // Extract price-related elements specifically
  const priceElements: string[] = [];
  const priceSelectors = [
    '[class*="price"]',
    '[class*="Price"]',
    '[data-testid*="price"]',
    '[itemprop="price"]',
    '[data-price]',
  ];

  for (const selector of priceSelectors) {
    $(selector).each((_, el) => {
      const text = $(el).text().trim();
      const parent = $(el).parent().text().trim().slice(0, 200);
      if (text && text.match(/\$[\d,]+\.?\d*/)) {
        priceElements.push(`Price element: "${text}" (context: "${parent.slice(0, 100)}")`);
      }
    });
  }

  // Now remove script, style, and other non-content elements
  $('script, style, noscript, iframe, svg, path, meta, link, comment').remove();

  // Get the body content
  let content = $('body').html() || html;

  // Try to focus on product-related sections if possible
  const productSelectors = [
    '[itemtype*="Product"]',
    '[class*="product-detail"]',
    '[class*="productDetail"]',
    '[class*="pdp-"]',
    '[id*="product"]',
    'main',
    '[role="main"]',
  ];

  for (const selector of productSelectors) {
    const section = $(selector).first();
    if (section.length && section.html() && section.html()!.length > 500) {
      content = section.html()!;
      break;
    }
  }

  // Build final content with all price-related info at the top
  let finalContent = '';

  if (jsonLdScripts.length > 0) {
    finalContent += `=== JSON-LD Structured Data (MOST RELIABLE) ===\n${jsonLdScripts.join('\n')}\n\n`;
    console.log(`[AI] Found ${jsonLdScripts.length} JSON-LD scripts with product data`);
  }

  if (priceElements.length > 0) {
    finalContent += `=== Price Elements Found ===\n${priceElements.slice(0, 10).join('\n')}\n\n`;
    console.log(`[AI] Found ${priceElements.length} price elements`);
  }

  finalContent += `=== HTML Content ===\n${content}`;

  // Truncate to ~25000 characters to stay within token limits but capture more content
  if (finalContent.length > 25000) {
    finalContent = finalContent.substring(0, 25000) + '\n... [truncated]';
  }

  console.log(`[AI] Prepared HTML content: ${finalContent.length} characters`);
  return finalContent;
}

// Default models to use if user hasn't selected one
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-nano-2025-04-14';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

async function extractWithAnthropic(
  html: string,
  apiKey: string,
  model?: string | null
): Promise<AIExtractionResult> {
  const anthropic = new Anthropic({ apiKey });

  const preparedHtml = prepareHtmlForAI(html);
  const modelToUse = model || DEFAULT_ANTHROPIC_MODEL;

  const response = await anthropic.messages.create({
    model: modelToUse,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: EXTRACTION_PROMPT + preparedHtml,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return parseAIResponse(content.text);
}

async function extractWithOpenAI(
  html: string,
  apiKey: string,
  model?: string | null,
  baseURL?: string
): Promise<AIExtractionResult> {
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });

  const preparedHtml = prepareHtmlForAI(html);
  const modelToUse = model || DEFAULT_OPENAI_MODEL;

  const response = await openai.chat.completions.create({
    model: modelToUse,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: EXTRACTION_PROMPT + preparedHtml,
      },
    ],
  });

  const message = response.choices[0]?.message;
  // Some models (DeepSeek R1) put response in reasoning_content instead of content
  const content = message?.content || (message as unknown as Record<string, unknown>)?.reasoning_content as string;
  if (!content) {
    throw new Error(`Empty response from model ${modelToUse}`);
  }

  return parseAIResponse(stripThinkingTags(content));
}

async function extractWithOllama(
  html: string,
  baseUrl: string,
  model: string
): Promise<AIExtractionResult> {
  const preparedHtml = prepareHtmlForAI(html);

  // Ollama uses a chat completions API similar to OpenAI
  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model: model,
      messages: [
        {
          role: 'user',
          content: '/nothink', // Disable thinking mode for Qwen3/DeepSeek
        },
        {
          role: 'assistant',
          content: 'Ok.',
        },
        {
          role: 'user',
          content: EXTRACTION_PROMPT + preparedHtml,
        },
      ],
      stream: false,
      options: {
        num_ctx: 16384, // Increase context window for large HTML content
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 120000, // Longer timeout for local models
    }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error('No response from Ollama');
  }

  return parseAIResponse(content);
}

async function extractWithGemini(
  html: string,
  apiKey: string,
  model?: string | null
): Promise<AIExtractionResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = model || DEFAULT_GEMINI_MODEL;
  const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

  const preparedHtml = prepareHtmlForAI(html);

  const result = await geminiModel.generateContent(EXTRACTION_PROMPT + preparedHtml);
  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Gemini');
  }

  return parseAIResponse(content);
}

// Verification functions for each provider
async function verifyWithAnthropic(
  html: string,
  scrapedPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null
): Promise<AIVerificationResult> {
  const anthropic = new Anthropic({ apiKey });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = VERIFICATION_PROMPT
    .replace('$SCRAPED_PRICE$', scrapedPrice.toString())
    .replace('$CURRENCY$', currency) + preparedHtml;
  const modelToUse = model || DEFAULT_ANTHROPIC_MODEL;

  const response = await anthropic.messages.create({
    model: modelToUse,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return parseVerificationResponse(content.text, scrapedPrice, currency);
}

async function verifyWithOpenAI(
  html: string,
  scrapedPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null,
  baseURL?: string
): Promise<AIVerificationResult> {
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = VERIFICATION_PROMPT
    .replace('$SCRAPED_PRICE$', scrapedPrice.toString())
    .replace('$CURRENCY$', currency) + preparedHtml;
  const modelToUse = model || DEFAULT_OPENAI_MODEL;

  const response = await openai.chat.completions.create({
    model: modelToUse,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const verifyMsg = response.choices[0]?.message;
  const content = verifyMsg?.content || (verifyMsg as unknown as Record<string, unknown>)?.reasoning_content as string;
  if (!content) {
    throw new Error(`Empty response from model ${modelToUse}`);
  }

  return parseVerificationResponse(stripThinkingTags(content), scrapedPrice, currency);
}

async function verifyWithOllama(
  html: string,
  scrapedPrice: number,
  currency: string,
  baseUrl: string,
  model: string
): Promise<AIVerificationResult> {
  const preparedHtml = prepareHtmlForAI(html);
  const prompt = VERIFICATION_PROMPT
    .replace('$SCRAPED_PRICE$', scrapedPrice.toString())
    .replace('$CURRENCY$', currency) + preparedHtml;

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model: model,
      messages: [
        { role: 'user', content: '/nothink' },
        { role: 'assistant', content: 'Ok.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        num_ctx: 16384, // Increase context window for large HTML content
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error('No response from Ollama');
  }

  return parseVerificationResponse(content, scrapedPrice, currency);
}

async function verifyWithGemini(
  html: string,
  scrapedPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null
): Promise<AIVerificationResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = model || DEFAULT_GEMINI_MODEL;
  const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = VERIFICATION_PROMPT
    .replace('$SCRAPED_PRICE$', scrapedPrice.toString())
    .replace('$CURRENCY$', currency) + preparedHtml;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Gemini');
  }

  return parseVerificationResponse(content, scrapedPrice, currency);
}

// Stock status verification functions (for variant products with anchor price)
async function verifyStockStatusWithAnthropic(
  html: string,
  variantPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null
): Promise<AIStockStatusResult> {
  const anthropic = new Anthropic({ apiKey });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = STOCK_STATUS_PROMPT
    .replace(/\$VARIANT_PRICE\$/g, variantPrice.toString())
    .replace(/\$CURRENCY\$/g, currency) + preparedHtml;
  const modelToUse = model || DEFAULT_ANTHROPIC_MODEL;

  const response = await anthropic.messages.create({
    model: modelToUse,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return parseStockStatusResponse(content.text);
}

async function verifyStockStatusWithOpenAI(
  html: string,
  variantPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null,
  baseURL?: string
): Promise<AIStockStatusResult> {
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = STOCK_STATUS_PROMPT
    .replace(/\$VARIANT_PRICE\$/g, variantPrice.toString())
    .replace(/\$CURRENCY\$/g, currency) + preparedHtml;
  const modelToUse = model || DEFAULT_OPENAI_MODEL;

  const response = await openai.chat.completions.create({
    model: modelToUse,
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const stockMsg = response.choices[0]?.message;
  const content = stockMsg?.content || (stockMsg as unknown as Record<string, unknown>)?.reasoning_content as string;
  if (!content) {
    throw new Error(`Empty response from model ${modelToUse}`);
  }

  return parseStockStatusResponse(stripThinkingTags(content));
}

async function verifyStockStatusWithOllama(
  html: string,
  variantPrice: number,
  currency: string,
  baseUrl: string,
  model: string
): Promise<AIStockStatusResult> {
  const preparedHtml = prepareHtmlForAI(html);
  const prompt = STOCK_STATUS_PROMPT
    .replace(/\$VARIANT_PRICE\$/g, variantPrice.toString())
    .replace(/\$CURRENCY\$/g, currency) + preparedHtml;

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model: model,
      messages: [
        { role: 'user', content: '/nothink' },
        { role: 'assistant', content: 'Ok.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        num_ctx: 16384, // Increase context window for large HTML content
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error('No response from Ollama');
  }

  return parseStockStatusResponse(content);
}

async function verifyStockStatusWithGemini(
  html: string,
  variantPrice: number,
  currency: string,
  apiKey: string,
  model?: string | null
): Promise<AIStockStatusResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = model || DEFAULT_GEMINI_MODEL;
  const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = STOCK_STATUS_PROMPT
    .replace(/\$VARIANT_PRICE\$/g, variantPrice.toString())
    .replace(/\$CURRENCY\$/g, currency) + preparedHtml;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Gemini');
  }

  return parseStockStatusResponse(content);
}

function parseStockStatusResponse(responseText: string): AIStockStatusResult {
  console.log(`[AI Stock] Raw response: ${responseText.substring(0, 500)}...`);

  // Default result if parsing fails
  const defaultResult: AIStockStatusResult = {
    stockStatus: 'unknown',
    confidence: 0,
    reason: 'Failed to parse AI response',
  };

  try {
    // Strip thinking tags from models like Qwen3/DeepSeek
    let jsonStr = stripThinkingTags(responseText);
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find raw JSON
      const rawJsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (rawJsonMatch) {
        jsonStr = rawJsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonStr);
    console.log(`[AI Stock] Parsed:`, JSON.stringify(parsed, null, 2));

    // Normalize stock status
    let stockStatus: StockStatus = 'unknown';
    if (parsed.stockStatus) {
      const status = parsed.stockStatus.toLowerCase().replace(/[^a-z_]/g, '');
      if (status === 'in_stock' || status === 'instock') {
        stockStatus = 'in_stock';
      } else if (status === 'out_of_stock' || status === 'outofstock') {
        stockStatus = 'out_of_stock';
      }
    }

    return {
      stockStatus,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reason: parsed.reason || 'No reason provided',
    };
  } catch (error) {
    console.error(`[AI Stock] Failed to parse response:`, error);
    return defaultResult;
  }
}

function parseVerificationResponse(
  responseText: string,
  originalPrice: number,
  originalCurrency: string
): AIVerificationResult {
  console.log(`[AI Verify] Raw response: ${responseText.substring(0, 500)}...`);

  // Default result if parsing fails
  const defaultResult: AIVerificationResult = {
    isCorrect: true, // Assume correct if we can't parse
    confidence: 0.5,
    suggestedPrice: null,
    reason: 'Could not parse AI response',
    stockStatus: 'unknown',
  };

  // Strip thinking tags from models like Qwen3/DeepSeek
  let jsonStr = stripThinkingTags(responseText).trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const data = JSON.parse(jsonStr);
    console.log(`[AI Verify] Parsed:`, JSON.stringify(data, null, 2));

    let suggestedPrice: ParsedPrice | null = null;
    if (!data.isCorrect && data.suggestedPrice !== null && data.suggestedPrice !== undefined) {
      const priceNum = typeof data.suggestedPrice === 'string'
        ? parseFloat(data.suggestedPrice.replace(/[^0-9.]/g, ''))
        : data.suggestedPrice;

      if (!isNaN(priceNum) && priceNum > 0) {
        suggestedPrice = {
          price: priceNum,
          currency: data.suggestedCurrency || originalCurrency,
        };
      }
    }

    // Parse stock status from AI response
    let stockStatus: StockStatus = 'unknown';
    if (data.stockStatus) {
      const status = data.stockStatus.toLowerCase().replace(/[^a-z_]/g, '');
      if (status === 'in_stock' || status === 'instock') {
        stockStatus = 'in_stock';
      } else if (status === 'out_of_stock' || status === 'outofstock') {
        stockStatus = 'out_of_stock';
      }
    }

    return {
      isCorrect: data.isCorrect ?? true,
      confidence: data.confidence ?? 0.5,
      suggestedPrice,
      reason: data.reason || 'No reason provided',
      stockStatus,
    };
  } catch (error) {
    console.error('[AI Verify] Failed to parse response:', responseText);
    return defaultResult;
  }
}

function parseAIResponse(responseText: string): AIExtractionResult {
  console.log(`[AI] Raw response: ${responseText.substring(0, 500)}...`);

  // Strip thinking tags from models like Qwen3/DeepSeek, then try to extract JSON
  let jsonStr = stripThinkingTags(responseText).trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const data = JSON.parse(jsonStr);
    console.log(`[AI] Parsed data:`, JSON.stringify(data, null, 2));

    let price: ParsedPrice | null = null;
    if (data.price !== null && data.price !== undefined) {
      const priceNum = typeof data.price === 'string'
        ? parseFloat(data.price.replace(/[^0-9.]/g, ''))
        : data.price;

      if (!isNaN(priceNum) && priceNum > 0) {
        price = {
          price: priceNum,
          currency: data.currency || 'USD',
        };
      }
    }

    let stockStatus: StockStatus = 'unknown';
    if (data.stockStatus) {
      const status = data.stockStatus.toLowerCase().replace(/[^a-z_]/g, '');
      if (status === 'in_stock' || status === 'instock') {
        stockStatus = 'in_stock';
      } else if (status === 'out_of_stock' || status === 'outofstock') {
        stockStatus = 'out_of_stock';
      }
    }

    return {
      name: data.name || null,
      price,
      imageUrl: data.imageUrl || data.image || null,
      stockStatus,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    };
  } catch (error) {
    console.error('Failed to parse AI response:', responseText);
    return {
      name: null,
      price: null,
      imageUrl: null,
      stockStatus: 'unknown',
      confidence: 0,
    };
  }
}

export async function extractWithAI(
  url: string,
  settings: AISettings
): Promise<AIExtractionResult> {
  // Fetch the page HTML
  const response = await axios.get<string>(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    },
    timeout: 20000,
  });

  const html = response.data;

  // Use the configured provider
  if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
    return extractWithAnthropic(html, settings.anthropic_api_key, settings.anthropic_model);
  } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
    return extractWithOpenAI(html, settings.openai_api_key, settings.openai_model);
  } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
    return extractWithOllama(html, settings.ollama_base_url, settings.ollama_model);
  } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
    return extractWithGemini(html, settings.gemini_api_key, settings.gemini_model);
  } else if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
    return extractWithOpenAI(html, settings.openrouter_api_key, settings.openrouter_model, OPENROUTER_BASE_URL);
  }

  throw new Error('No valid AI provider configured');
}

// Export for use in scraper as fallback
export async function tryAIExtraction(
  url: string,
  html: string,
  userId: number
): Promise<AIExtractionResult | null> {
  try {
    // Import dynamically to avoid circular dependencies
    const { userQueries } = await import('../models');
    const settings = await userQueries.getAISettings(userId);

    if (!settings?.ai_enabled) {
      return null;
    }

    // Use the configured provider
    if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
      const modelToUse = settings.anthropic_model || DEFAULT_ANTHROPIC_MODEL;
      console.log(`[AI] Using Anthropic (${modelToUse}) for ${url}`);
      return await extractWithAnthropic(html, settings.anthropic_api_key, settings.anthropic_model);
    } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
      const modelToUse = settings.openai_model || DEFAULT_OPENAI_MODEL;
      console.log(`[AI] Using OpenAI (${modelToUse}) for ${url}`);
      return await extractWithOpenAI(html, settings.openai_api_key, settings.openai_model);
    } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
      console.log(`[AI] Using Ollama (${settings.ollama_model}) for ${url}`);
      return await extractWithOllama(html, settings.ollama_base_url, settings.ollama_model);
    } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
      const modelToUse = settings.gemini_model || DEFAULT_GEMINI_MODEL;
      console.log(`[AI] Using Gemini (${modelToUse}) for ${url}`);
      return await extractWithGemini(html, settings.gemini_api_key, settings.gemini_model);
    } else if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
      console.log(`[AI] Using OpenRouter (${settings.openrouter_model || 'default'}) for ${url}`);
      return await extractWithOpenAI(html, settings.openrouter_api_key, settings.openrouter_model, OPENROUTER_BASE_URL);
    }

    return null;
  } catch (error) {
    console.error(`[AI] Extraction failed for ${url}:`, error);
    return null;
  }
}

// Export for use in scraper to verify scraped prices
export async function tryAIVerification(
  url: string,
  html: string,
  scrapedPrice: number,
  currency: string,
  userId: number
): Promise<AIVerificationResult | null> {
  try {
    const { userQueries } = await import('../models');
    const settings = await userQueries.getAISettings(userId);

    // Check if AI verification is enabled (separate from AI extraction fallback)
    if (!settings?.ai_verification_enabled) {
      return null;
    }

    // Need a configured provider
    if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
      const modelToUse = settings.anthropic_model || DEFAULT_ANTHROPIC_MODEL;
      console.log(`[AI Verify] Using Anthropic (${modelToUse}) to verify $${scrapedPrice} for ${url}`);
      return await verifyWithAnthropic(html, scrapedPrice, currency, settings.anthropic_api_key, settings.anthropic_model);
    } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
      const modelToUse = settings.openai_model || DEFAULT_OPENAI_MODEL;
      console.log(`[AI Verify] Using OpenAI (${modelToUse}) to verify $${scrapedPrice} for ${url}`);
      return await verifyWithOpenAI(html, scrapedPrice, currency, settings.openai_api_key, settings.openai_model);
    } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
      console.log(`[AI Verify] Using Ollama (${settings.ollama_model}) to verify $${scrapedPrice} for ${url}`);
      return await verifyWithOllama(html, scrapedPrice, currency, settings.ollama_base_url, settings.ollama_model);
    } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
      const modelToUse = settings.gemini_model || DEFAULT_GEMINI_MODEL;
      console.log(`[AI Verify] Using Gemini (${modelToUse}) to verify $${scrapedPrice} for ${url}`);
      return await verifyWithGemini(html, scrapedPrice, currency, settings.gemini_api_key, settings.gemini_model);
    } else if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
      console.log(`[AI Verify] Using OpenRouter (${settings.openrouter_model || 'default'}) to verify $${scrapedPrice} for ${url}`);
      return await verifyWithOpenAI(html, scrapedPrice, currency, settings.openrouter_api_key, settings.openrouter_model, OPENROUTER_BASE_URL);
    }

    console.log(`[AI Verify] Verification enabled but no provider configured`);
    return null;
  } catch (error) {
    console.error(`[AI Verify] Verification failed for ${url}:`, error);
    return null;
  }
}

// Export for use in scraper to verify stock status for a specific variant price
export async function tryAIStockStatusVerification(
  url: string,
  html: string,
  variantPrice: number,
  currency: string,
  userId: number
): Promise<AIStockStatusResult | null> {
  try {
    const { userQueries } = await import('../models');
    const settings = await userQueries.getAISettings(userId);

    // Need AI enabled for stock status verification
    if (!settings?.ai_enabled && !settings?.ai_verification_enabled) {
      return null;
    }

    // Need a configured provider
    if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
      const modelToUse = settings.anthropic_model || DEFAULT_ANTHROPIC_MODEL;
      console.log(`[AI Stock] Using Anthropic (${modelToUse}) to verify stock status for $${variantPrice} variant at ${url}`);
      return await verifyStockStatusWithAnthropic(html, variantPrice, currency, settings.anthropic_api_key, settings.anthropic_model);
    } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
      const modelToUse = settings.openai_model || DEFAULT_OPENAI_MODEL;
      console.log(`[AI Stock] Using OpenAI (${modelToUse}) to verify stock status for $${variantPrice} variant at ${url}`);
      return await verifyStockStatusWithOpenAI(html, variantPrice, currency, settings.openai_api_key, settings.openai_model);
    } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
      console.log(`[AI Stock] Using Ollama (${settings.ollama_model}) to verify stock status for $${variantPrice} variant at ${url}`);
      return await verifyStockStatusWithOllama(html, variantPrice, currency, settings.ollama_base_url, settings.ollama_model);
    } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
      const modelToUse = settings.gemini_model || DEFAULT_GEMINI_MODEL;
      console.log(`[AI Stock] Using Gemini (${modelToUse}) to verify stock status for $${variantPrice} variant at ${url}`);
      return await verifyStockStatusWithGemini(html, variantPrice, currency, settings.gemini_api_key, settings.gemini_model);
    } else if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
      console.log(`[AI Stock] Using OpenRouter (${settings.openrouter_model || 'default'}) to verify stock status for $${variantPrice} variant at ${url}`);
      return await verifyStockStatusWithOpenAI(html, variantPrice, currency, settings.openrouter_api_key, settings.openrouter_model, OPENROUTER_BASE_URL);
    }

    console.log(`[AI Stock] No AI provider configured for stock status verification`);
    return null;
  } catch (error) {
    console.error(`[AI Stock] Stock status verification failed for ${url}:`, error);
    return null;
  }
}

// Arbitration prompt for when multiple extraction methods disagree
const ARBITRATION_PROMPT = `You are a price arbitration assistant. Multiple price extraction methods found different prices for the same product. Help determine the correct price.

Found prices:
$CANDIDATES$

Analyze the HTML content below and determine which price is the correct CURRENT selling price for the main product.

Consider:
- JSON-LD structured data is usually highly reliable (schema.org standard)
- Site-specific extractors are well-tested for major retailers
- Generic CSS selectors might catch wrong prices (shipping, savings, bundles, etc.)
- Look for the price that appears in the main product display area
- Ignore crossed-out/original prices, shipping costs, subscription prices, or bundle prices

Return a JSON object with:
- selectedIndex: the 0-based index of the correct price from the list above
- confidence: your confidence from 0 to 1
- reason: brief explanation of why this price is correct

Only return valid JSON, no explanation text outside the JSON.

HTML Content:
`;

export interface AIArbitrationResult {
  selectedPrice: PriceCandidate | null;
  confidence: number;
  reason: string;
}

async function arbitrateWithAnthropic(
  html: string,
  candidates: PriceCandidate[],
  apiKey: string,
  model?: string | null
): Promise<AIArbitrationResult> {
  const anthropic = new Anthropic({ apiKey });

  const candidatesList = candidates.map((c, i) =>
    `${i}. ${c.price} ${c.currency} (method: ${c.method}, context: ${c.context || 'none'})`
  ).join('\n');

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = ARBITRATION_PROMPT.replace('$CANDIDATES$', candidatesList) + preparedHtml;
  const modelToUse = model || DEFAULT_ANTHROPIC_MODEL;

  const response = await anthropic.messages.create({
    model: modelToUse,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return parseArbitrationResponse(content.text, candidates);
}

async function arbitrateWithOpenAI(
  html: string,
  candidates: PriceCandidate[],
  apiKey: string,
  model?: string | null,
  baseURL?: string
): Promise<AIArbitrationResult> {
  const openai = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });

  const candidatesList = candidates.map((c, i) =>
    `${i}. ${c.price} ${c.currency} (method: ${c.method}, context: ${c.context || 'none'})`
  ).join('\n');

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = ARBITRATION_PROMPT.replace('$CANDIDATES$', candidatesList) + preparedHtml;
  const modelToUse = model || DEFAULT_OPENAI_MODEL;

  const response = await openai.chat.completions.create({
    model: modelToUse,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const arbMsg = response.choices[0]?.message;
  const content = arbMsg?.content || (arbMsg as unknown as Record<string, unknown>)?.reasoning_content as string;
  if (!content) {
    throw new Error(`Empty response from model ${modelToUse}`);
  }

  return parseArbitrationResponse(content, candidates);
}

async function arbitrateWithOllama(
  html: string,
  candidates: PriceCandidate[],
  baseUrl: string,
  model: string
): Promise<AIArbitrationResult> {
  const candidatesList = candidates.map((c, i) =>
    `${i}. ${c.price} ${c.currency} (method: ${c.method}, context: ${c.context || 'none'})`
  ).join('\n');

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = ARBITRATION_PROMPT.replace('$CANDIDATES$', candidatesList) + preparedHtml;

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model: model,
      messages: [
        { role: 'user', content: '/nothink' },
        { role: 'assistant', content: 'Ok.' },
        { role: 'user', content: prompt },
      ],
      stream: false,
      options: {
        num_ctx: 16384, // Increase context window for large HTML content
      },
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    }
  );

  const content = response.data?.message?.content;
  if (!content) {
    throw new Error('No response from Ollama');
  }

  return parseArbitrationResponse(content, candidates);
}

async function arbitrateWithGemini(
  html: string,
  candidates: PriceCandidate[],
  apiKey: string,
  model?: string | null
): Promise<AIArbitrationResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelToUse = model || DEFAULT_GEMINI_MODEL;
  const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

  const candidatesList = candidates.map((c, i) =>
    `${i}. ${c.price} ${c.currency} (method: ${c.method}, context: ${c.context || 'none'})`
  ).join('\n');

  const preparedHtml = prepareHtmlForAI(html);
  const prompt = ARBITRATION_PROMPT.replace('$CANDIDATES$', candidatesList) + preparedHtml;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const content = response.text();

  if (!content) {
    throw new Error('No response from Gemini');
  }

  return parseArbitrationResponse(content, candidates);
}

function parseArbitrationResponse(
  responseText: string,
  candidates: PriceCandidate[]
): AIArbitrationResult {
  console.log(`[AI Arbitrate] Raw response: ${responseText.substring(0, 500)}...`);

  const defaultResult: AIArbitrationResult = {
    selectedPrice: null,
    confidence: 0,
    reason: 'Could not parse AI response',
  };

  // Strip thinking tags from models like Qwen3/DeepSeek
  let jsonStr = stripThinkingTags(responseText).trim();

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const data = JSON.parse(jsonStr);
    console.log(`[AI Arbitrate] Parsed:`, JSON.stringify(data, null, 2));

    const selectedIndex = data.selectedIndex;
    if (typeof selectedIndex === 'number' && selectedIndex >= 0 && selectedIndex < candidates.length) {
      return {
        selectedPrice: candidates[selectedIndex],
        confidence: data.confidence ?? 0.7,
        reason: data.reason || 'AI selected this price',
      };
    }

    return defaultResult;
  } catch (error) {
    console.error('[AI Arbitrate] Failed to parse response:', responseText);
    return defaultResult;
  }
}

// Export for use in voting scraper to arbitrate between disagreeing methods
export async function tryAIArbitration(
  url: string,
  html: string,
  candidates: PriceCandidate[],
  userId: number
): Promise<AIArbitrationResult | null> {
  try {
    const { userQueries } = await import('../models');
    const settings = await userQueries.getAISettings(userId);

    // Need AI enabled for arbitration
    if (!settings?.ai_enabled && !settings?.ai_verification_enabled) {
      return null;
    }

    // Need at least 2 candidates to arbitrate
    if (candidates.length < 2) {
      return null;
    }

    // Use the configured provider
    if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
      const modelToUse = settings.anthropic_model || DEFAULT_ANTHROPIC_MODEL;
      console.log(`[AI Arbitrate] Using Anthropic (${modelToUse}) to arbitrate ${candidates.length} prices for ${url}`);
      return await arbitrateWithAnthropic(html, candidates, settings.anthropic_api_key, settings.anthropic_model);
    } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
      const modelToUse = settings.openai_model || DEFAULT_OPENAI_MODEL;
      console.log(`[AI Arbitrate] Using OpenAI (${modelToUse}) to arbitrate ${candidates.length} prices for ${url}`);
      return await arbitrateWithOpenAI(html, candidates, settings.openai_api_key, settings.openai_model);
    } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
      console.log(`[AI Arbitrate] Using Ollama (${settings.ollama_model}) to arbitrate ${candidates.length} prices for ${url}`);
      return await arbitrateWithOllama(html, candidates, settings.ollama_base_url, settings.ollama_model);
    } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
      const modelToUse = settings.gemini_model || DEFAULT_GEMINI_MODEL;
      console.log(`[AI Arbitrate] Using Gemini (${modelToUse}) to arbitrate ${candidates.length} prices for ${url}`);
      return await arbitrateWithGemini(html, candidates, settings.gemini_api_key, settings.gemini_model);
    } else if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
      console.log(`[AI Arbitrate] Using OpenRouter (${settings.openrouter_model || 'default'}) to arbitrate ${candidates.length} prices for ${url}`);
      return await arbitrateWithOpenAI(html, candidates, settings.openrouter_api_key, settings.openrouter_model, OPENROUTER_BASE_URL);
    }

    console.log(`[AI Arbitrate] No provider configured`);
    return null;
  } catch (error) {
    console.error(`[AI Arbitrate] Arbitration failed for ${url}:`, error);
    return null;
  }
}

// --- Sub-Agent: Find Better Prices ---

export interface PriceComparison {
  store: string;
  price: number;
  currency: string;
  url: string;
}

interface ProductIdentity {
  searchTerm: string;
  brand: string | null;
  model: string | null;
  ean: string | null;
}

const SUBAGENT_SEARCH_PROMPT = `You are a price comparison assistant with web search. Find this exact product at other online stores and return current prices with direct product page URLs.

Return a JSON array with these fields:
- store: The store name (string)
- price: The current selling price as a number
- currency: The currency code (EUR, USD, etc.)
- url: Direct product page URL where the price is visible

Important:
- Every URL must be a direct product page (e.g. /product/12345 or /p/product-name-sku)
- Never return store homepages, search result pages, category listings, or price comparison sites
- Only include prices you found on actual product pages
- Prioritize Finnish stores (.fi / .com) first, then Nordic/EU stores that ship to Finland
- Only return valid JSON array, no explanation text

Product search query:
`;

const PRODUCT_IDENTITY_PROMPT = `Analyze this product page HTML and extract key product identifiers for searching.

Return a JSON object:
- searchTerm: a clean, concise product name suitable for web search (brand + model + key specs, no store name or marketing text)
- brand: the brand/manufacturer name (or null)
- model: the model number/name (or null)
- ean: EAN, UPC, GTIN, or SKU code if found in the page (or null)

Only return valid JSON, no explanation text.

HTML Content:
`;

async function extractProductIdentity(
  productUrl: string,
  productName: string,
  settings: AISettings
): Promise<ProductIdentity> {
  // Default fallback: use the DB product name as-is
  const fallback: ProductIdentity = { searchTerm: productName, brand: null, model: null, ean: null };

  // Check if main AI is configured
  if (!settings.ai_enabled || !settings.ai_provider) {
    console.log('[Sub-Agent] Main AI not configured, using raw product name');
    return fallback;
  }

  try {
    const response = await axios.get<string>(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 20000,
    });

    const html = response.data;
    const preparedHtml = prepareHtmlForAI(html);
    const prompt = PRODUCT_IDENTITY_PROMPT + preparedHtml;

    let content: string | null = null;

    if (settings.ai_provider === 'openrouter' && settings.openrouter_api_key) {
      const client = new OpenAI({ apiKey: settings.openrouter_api_key, baseURL: OPENROUTER_BASE_URL });
      const res = await client.chat.completions.create({
        model: settings.openrouter_model || 'openai/gpt-4.1-nano',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      });
      const msg = res.choices[0]?.message;
      content = msg?.content || (msg as unknown as Record<string, unknown>)?.reasoning_content as string;
    } else if (settings.ai_provider === 'anthropic' && settings.anthropic_api_key) {
      const anthropic = new Anthropic({ apiKey: settings.anthropic_api_key });
      const res = await anthropic.messages.create({
        model: settings.anthropic_model || 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });
      content = res.content[0]?.type === 'text' ? res.content[0].text : null;
    } else if (settings.ai_provider === 'openai' && settings.openai_api_key) {
      const client = new OpenAI({ apiKey: settings.openai_api_key });
      const res = await client.chat.completions.create({
        model: settings.openai_model || 'gpt-4.1-nano',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      });
      content = res.choices[0]?.message?.content;
    } else if (settings.ai_provider === 'gemini' && settings.gemini_api_key) {
      const genAI = new GoogleGenerativeAI(settings.gemini_api_key);
      const model = genAI.getGenerativeModel({ model: settings.gemini_model || 'gemini-2.5-flash-lite' });
      const res = await model.generateContent(prompt);
      content = res.response.text();
    } else if (settings.ai_provider === 'ollama' && settings.ollama_base_url && settings.ollama_model) {
      const res = await axios.post(`${settings.ollama_base_url}/api/generate`, {
        model: settings.ollama_model,
        prompt,
        stream: false,
      }, { timeout: 60000 });
      content = res.data?.response;
    }

    if (!content) {
      console.log('[Sub-Agent] Main AI returned no content for product identity');
      return fallback;
    }

    content = stripThinkingTags(content);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[Sub-Agent] No JSON found in main AI response');
      return fallback;
    }

    const identity = JSON.parse(jsonMatch[0]) as ProductIdentity;
    console.log(`[Sub-Agent] Main AI identified product: "${identity.searchTerm}" (brand: ${identity.brand}, model: ${identity.model}, ean: ${identity.ean})`);
    return identity;
  } catch (error) {
    console.error('[Sub-Agent] Failed to extract product identity:', error);
    return fallback;
  }
}

export async function findBetterPrices(
  productName: string,
  currentPrice: number,
  currency: string,
  productUrl: string,
  settings: AISettings
): Promise<PriceComparison[]> {
  if (!settings.subagent_api_key || !settings.subagent_model) {
    throw new Error('Sub-agent not configured: API key and model are required');
  }

  // Step 1: Main AI extracts a clean product identity
  console.log(`[Sub-Agent] Step 1: Asking main AI to identify product from "${productName}"`);
  const identity = await extractProductIdentity(productUrl, productName, settings);

  // Build search context for sub-agent
  const identifiers: string[] = [];
  if (identity.brand) identifiers.push(`Brand: ${identity.brand}`);
  if (identity.model) identifiers.push(`Model: ${identity.model}`);
  if (identity.ean) identifiers.push(`EAN/SKU: ${identity.ean}`);
  // Step 2: Sub-agent searches the web
  const domainMatch = productUrl.match(/^https?:\/\/(?:www\.)?([^/]+)/);
  const currentDomain = domainMatch ? domainMatch[1] : '';
  const searchContext = [
    `${identity.searchTerm}`,
    ...identifiers,
    `Current price: ${currentPrice} ${currency}`,
    `Exclude store: ${currentDomain}`,
  ].join('\n');

  const basePrompt = settings.subagent_custom_prompt?.trim() || SUBAGENT_SEARCH_PROMPT;
  const prompt = basePrompt + searchContext;

  console.log(`[Sub-Agent] Step 2: Searching for "${identity.searchTerm}" (${currentPrice} ${currency})`);

  const openai = new OpenAI({
    apiKey: settings.subagent_api_key,
    baseURL: OPENROUTER_BASE_URL,
  });

  const response = await openai.chat.completions.create({
    model: settings.subagent_model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });

  const message = response.choices[0]?.message;
  const rawContent = message?.content
    || (message as unknown as Record<string, unknown>)?.reasoning_content as string;

  if (!rawContent) {
    console.log('[Sub-Agent] No response from model');
    return [];
  }

  const content = stripThinkingTags(rawContent);
  console.log(`[Sub-Agent] Raw response length: ${content.length}`);

  // Extract JSON array from response (model might wrap it in markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.log('[Sub-Agent] No JSON array found in response');
    return [];
  }

  const results = JSON.parse(jsonMatch[0]) as PriceComparison[];

  // Validate fields
  const validResults = results.filter(r =>
    r.store && typeof r.price === 'number' && r.price > 0 && r.currency && r.url
  ).slice(0, 10);

  if (validResults.length === 0) return [];

  // Step 3: Optionally verify URLs are reachable (parallel HEAD requests)
  if (!settings.subagent_validate_urls) {
    console.log(`[Sub-Agent] URL validation disabled, returning ${validResults.length} results`);
    return validResults;
  }

  console.log(`[Sub-Agent] Step 3: Verifying ${validResults.length} URLs...`);
  const verified = await Promise.all(
    validResults.map(async (r) => {
      try {
        const res = await axios.head(r.url, {
          timeout: 8000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          },
          validateStatus: (status: number) => status < 400,
        });
        return { result: r, ok: res.status < 400 };
      } catch {
        // HEAD might be blocked; try GET with range header as fallback
        try {
          const res = await axios.get(r.url, {
            timeout: 8000,
            maxRedirects: 5,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              Range: 'bytes=0-0',
            },
            validateStatus: (status: number) => status < 400 || status === 416,
          });
          return { result: r, ok: res.status < 400 || res.status === 416 };
        } catch {
          return { result: r, ok: false };
        }
      }
    })
  );

  const validUrls = verified.filter(v => v.ok).map(v => v.result);
  const invalidCount = verified.length - validUrls.length;
  if (invalidCount > 0) {
    console.log(`[Sub-Agent] Filtered out ${invalidCount} unreachable URLs`);
  }

  return validUrls;
}
