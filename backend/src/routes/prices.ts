import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { productQueries, priceHistoryQueries } from '../models';
import { scrapeProduct } from '../services/scraper';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get price history for a product
router.get('/:productId/prices', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    // Verify product belongs to user
    const product = await productQueries.findById(productId, userId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Get optional days filter from query
    const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;

    const priceHistory = await priceHistoryQueries.findByProductId(
      productId,
      days
    );

    res.json({
      product,
      prices: priceHistory,
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

// Force immediate price refresh
router.post('/:productId/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    // Verify product belongs to user
    const product = await productQueries.findById(productId, userId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Scrape product data including price and stock status
    const scrapedData = await scrapeProduct(product.url);

    // Update stock status
    await productQueries.updateStockStatus(productId, scrapedData.stockStatus);

    // Record new price if available
    let newPrice = null;
    if (scrapedData.price) {
      newPrice = await priceHistoryQueries.create(
        productId,
        scrapedData.price.price,
        scrapedData.price.currency
      );
    }

    // Update last_checked timestamp
    await productQueries.updateLastChecked(productId);

    res.json({
      message: scrapedData.stockStatus === 'out_of_stock'
        ? 'Product is currently out of stock'
        : 'Price refreshed successfully',
      price: newPrice,
      stockStatus: scrapedData.stockStatus,
    });
  } catch (error) {
    console.error('Error refreshing price:', error);
    res.status(500).json({ error: 'Failed to refresh price' });
  }
});

export default router;
