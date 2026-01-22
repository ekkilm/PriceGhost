import { useState, useEffect } from 'react';
import { stockHistoryApi, StockStatusHistoryEntry, StockStatusStats } from '../api/client';

interface StockTimelineProps {
  productId: number;
  days?: number;
}

export default function StockTimeline({ productId, days = 30 }: StockTimelineProps) {
  const [history, setHistory] = useState<StockStatusHistoryEntry[]>([]);
  const [stats, setStats] = useState<StockStatusStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const response = await stockHistoryApi.getHistory(productId, days);
        setHistory(response.data.history);
        setStats(response.data.stats);
        setError(null);
      } catch {
        setError('Failed to load stock history');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [productId, days]);

  if (isLoading) {
    return (
      <div className="stock-timeline-loading">
        <span className="spinner" />
      </div>
    );
  }

  if (error || !stats || history.length === 0) {
    return null; // Don't show anything if no stock history data
  }

  // Calculate timeline segments
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const totalMs = now.getTime() - periodStart.getTime();

  const segments: { status: string; startPercent: number; widthPercent: number }[] = [];

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const entryTime = new Date(entry.changed_at);
    const nextEntry = history[i + 1];
    const nextTime = nextEntry ? new Date(nextEntry.changed_at) : now;

    // Clip to our period
    const segmentStart = entryTime < periodStart ? periodStart : entryTime;
    const segmentEnd = nextTime;

    if (segmentEnd <= periodStart) continue;

    const startPercent = ((segmentStart.getTime() - periodStart.getTime()) / totalMs) * 100;
    const widthPercent = ((segmentEnd.getTime() - segmentStart.getTime()) / totalMs) * 100;

    segments.push({
      status: entry.status,
      startPercent: Math.max(0, startPercent),
      widthPercent: Math.min(100 - startPercent, widthPercent),
    });
  }

  return (
    <>
      <style>{`
        .stock-timeline-card {
          background: var(--surface);
          border-radius: 0.75rem;
          box-shadow: var(--shadow);
          padding: 1.5rem;
          margin-top: 2rem;
        }

        .stock-timeline-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .stock-timeline-icon {
          font-size: 1.5rem;
        }

        .stock-timeline-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--text);
        }

        .stock-timeline-period {
          margin-left: auto;
          font-size: 0.875rem;
          color: var(--text-muted);
        }

        .stock-timeline-bar-container {
          margin: 1.5rem 0;
        }

        .stock-timeline-bar {
          height: 24px;
          background: var(--border);
          border-radius: 6px;
          overflow: hidden;
          position: relative;
        }

        .stock-timeline-segment {
          position: absolute;
          top: 0;
          height: 100%;
          transition: opacity 0.2s;
        }

        .stock-timeline-segment:hover {
          opacity: 0.8;
        }

        .stock-timeline-segment.in_stock {
          background: linear-gradient(180deg, #22c55e 0%, #16a34a 100%);
        }

        .stock-timeline-segment.out_of_stock {
          background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
        }

        .stock-timeline-segment.unknown {
          background: linear-gradient(180deg, #9ca3af 0%, #6b7280 100%);
        }

        .stock-timeline-legend {
          display: flex;
          gap: 1.5rem;
          margin-top: 0.75rem;
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .stock-timeline-legend-item {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .stock-timeline-legend-dot {
          width: 12px;
          height: 12px;
          border-radius: 3px;
        }

        .stock-timeline-legend-dot.in_stock {
          background: #22c55e;
        }

        .stock-timeline-legend-dot.out_of_stock {
          background: #ef4444;
        }

        .stock-timeline-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 1rem;
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--border);
        }

        .stock-timeline-stat {
          text-align: center;
        }

        .stock-timeline-stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
        }

        .stock-timeline-stat-value.good {
          color: #22c55e;
        }

        .stock-timeline-stat-value.bad {
          color: #ef4444;
        }

        .stock-timeline-stat-value.neutral {
          color: var(--text-muted);
        }

        .stock-timeline-stat-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 0.25rem;
        }

        .stock-timeline-loading {
          display: flex;
          justify-content: center;
          padding: 2rem;
        }
      `}</style>

      <div className="stock-timeline-card">
        <div className="stock-timeline-header">
          <span className="stock-timeline-icon">📊</span>
          <h2 className="stock-timeline-title">Stock Availability</h2>
          <span className="stock-timeline-period">Last {days} days</span>
        </div>

        <div className="stock-timeline-bar-container">
          <div className="stock-timeline-bar">
            {segments.map((segment, index) => (
              <div
                key={index}
                className={`stock-timeline-segment ${segment.status}`}
                style={{
                  left: `${segment.startPercent}%`,
                  width: `${segment.widthPercent}%`,
                }}
                title={`${segment.status === 'in_stock' ? 'In Stock' : segment.status === 'out_of_stock' ? 'Out of Stock' : 'Unknown'}`}
              />
            ))}
          </div>
          <div className="stock-timeline-legend">
            <div className="stock-timeline-legend-item">
              <div className="stock-timeline-legend-dot in_stock" />
              <span>In Stock</span>
            </div>
            <div className="stock-timeline-legend-item">
              <div className="stock-timeline-legend-dot out_of_stock" />
              <span>Out of Stock</span>
            </div>
          </div>
        </div>

        <div className="stock-timeline-stats">
          <div className="stock-timeline-stat">
            <div className={`stock-timeline-stat-value ${stats.availability_percent >= 80 ? 'good' : stats.availability_percent >= 50 ? 'neutral' : 'bad'}`}>
              {stats.availability_percent}%
            </div>
            <div className="stock-timeline-stat-label">Availability</div>
          </div>

          <div className="stock-timeline-stat">
            <div className={`stock-timeline-stat-value ${stats.outage_count === 0 ? 'good' : stats.outage_count <= 2 ? 'neutral' : 'bad'}`}>
              {stats.outage_count}
            </div>
            <div className="stock-timeline-stat-label">Times Out of Stock</div>
          </div>

          {stats.avg_outage_days !== null && (
            <div className="stock-timeline-stat">
              <div className="stock-timeline-stat-value neutral">
                {stats.avg_outage_days}d
              </div>
              <div className="stock-timeline-stat-label">Avg Outage</div>
            </div>
          )}

          {stats.longest_outage_days !== null && (
            <div className="stock-timeline-stat">
              <div className="stock-timeline-stat-value neutral">
                {stats.longest_outage_days}d
              </div>
              <div className="stock-timeline-stat-label">Longest Outage</div>
            </div>
          )}

          <div className="stock-timeline-stat">
            <div className={`stock-timeline-stat-value ${stats.current_status === 'in_stock' ? 'good' : 'bad'}`}>
              {stats.days_in_current_status}d
            </div>
            <div className="stock-timeline-stat-label">
              {stats.current_status === 'in_stock' ? 'In Stock' : 'Out of Stock'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
