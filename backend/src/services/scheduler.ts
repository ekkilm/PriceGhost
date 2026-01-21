import cron from 'node-cron';
import { productQueries, priceHistoryQueries } from '../models';
import { scrapeProduct } from './scraper';

let isRunning = false;

async function checkPrices(): Promise<void> {
  if (isRunning) {
    console.log('Price check already in progress, skipping...');
    return;
  }

  isRunning = true;
  console.log('Starting scheduled price check...');

  try {
    // Find all products that are due for a refresh
    const products = await productQueries.findDueForRefresh();
    console.log(`Found ${products.length} products to check`);

    for (const product of products) {
      try {
        console.log(`Checking price for product ${product.id}: ${product.url}`);

        const scrapedData = await scrapeProduct(product.url);

        // Update stock status
        if (scrapedData.stockStatus !== product.stock_status) {
          await productQueries.updateStockStatus(product.id, scrapedData.stockStatus);
          console.log(
            `Stock status changed for product ${product.id}: ${product.stock_status} -> ${scrapedData.stockStatus}`
          );
        }

        if (scrapedData.price) {
          // Get the latest recorded price to compare
          const latestPrice = await priceHistoryQueries.getLatest(product.id);

          // Only record if price has changed or it's the first entry
          if (!latestPrice || latestPrice.price !== scrapedData.price.price) {
            await priceHistoryQueries.create(
              product.id,
              scrapedData.price.price,
              scrapedData.price.currency
            );
            console.log(
              `Recorded new price for product ${product.id}: ${scrapedData.price.currency} ${scrapedData.price.price}`
            );
          } else {
            console.log(`Price unchanged for product ${product.id}`);
          }
        } else if (scrapedData.stockStatus === 'out_of_stock') {
          console.log(`Product ${product.id} is out of stock, no price available`);
        } else {
          console.warn(`Could not extract price for product ${product.id}`);
        }

        // Update last_checked even if price extraction failed
        await productQueries.updateLastChecked(product.id);

        // Add a small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error checking product ${product.id}:`, error);
        // Continue with next product even if one fails
      }
    }
  } catch (error) {
    console.error('Error in scheduled price check:', error);
  } finally {
    isRunning = false;
    console.log('Scheduled price check complete');
  }
}

export function startScheduler(): void {
  // Run every minute
  cron.schedule('* * * * *', () => {
    checkPrices().catch(console.error);
  });

  console.log('Price check scheduler started (runs every minute)');
}

// Allow manual trigger for testing
export { checkPrices };
