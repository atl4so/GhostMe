import { FC, useEffect, useState } from 'react';
import { formatKasAmount } from '../utils/format';
import { useWalletStore } from '../store/wallet.store';

interface FeeBucketsProps {
  inline?: boolean;
}

/**
 * Fee bucket component that displays network fee rate estimates
 */
export const FeeBuckets: FC<FeeBucketsProps> = ({ inline = false }) => {
  const rpcClient = useWalletStore((s) => s.rpcClient);
  const [feeEstimate, setFeeEstimate] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeeEstimates = async () => {
      if (!rpcClient?.rpc) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // Get fee estimates from RPC client
        const result = await rpcClient.rpc.getFeeEstimate();
        console.log('Fee estimates raw response:', result);
        
        // Store the entire response for debugging
        setFeeEstimate(result);
      } catch (err) {
        console.error('Failed to fetch fee estimates:', err);
        setError('Failed to fetch fee estimates');
      } finally {
        setLoading(false);
      }
    };

    fetchFeeEstimates();
    
    // Refresh every 2 minutes
    const interval = setInterval(fetchFeeEstimates, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [rpcClient]);

  if (loading && !feeEstimate) {
    return inline ? null : (
      <div className="fee-buckets">
        <h4>Network Fee Rates</h4>
        <div className="loading">Loading fee estimates...</div>
      </div>
    );
  }

  if (error && !feeEstimate) {
    return inline ? null : (
      <div className="fee-buckets">
        <h4>Network Fee Rates</h4>
        <div className="error">{error}</div>
      </div>
    );
  }

  // Early return if no estimate available
  if (!feeEstimate) return null;
  
  // Get the estimate from the response
  const estimate = feeEstimate.estimate || {};

  // Helper function to safely format fee rate
  const formatFeeRate = (value: any) => {
    if (value === undefined || value === null) return 'N/A';
    return typeof value === 'number' ? value.toFixed(4) : String(value);
  };
  
  // Helper function to safely format time
  const formatTime = (seconds: any, useMinutes: boolean = false) => {
    if (seconds === undefined || seconds === null) return 'N/A';
    const value = Number(seconds);
    return isNaN(value) ? 'N/A' : 
      useMinutes ? `~${Math.round(value / 60)}m` : `~${Math.round(value)}s`;
  };

  // For inline display, show all three buckets in a compact format
  if (inline) {
    return (
      <div className="fee-buckets-inline">
        {estimate.priorityBucket && (
          <div className="fee-rate-inline priority" title={`Priority - Time: ${formatTime(estimate.priorityBucket.estimatedSeconds)}`}>
            <span className="fee-label">P:</span>
            <span className="fee-value">{formatFeeRate(estimate.priorityBucket.feerate)}</span>
          </div>
        )}
        {estimate.normalBuckets && estimate.normalBuckets.length > 0 && (
          <div className="fee-rate-inline normal" title={`Normal - Time: ${formatTime(estimate.normalBuckets[0]?.estimatedSeconds, true)}`}>
            <span className="fee-label">N:</span>
            <span className="fee-value">{formatFeeRate(estimate.normalBuckets[0]?.feerate)}</span>
          </div>
        )}
        {estimate.lowBuckets && estimate.lowBuckets.length > 0 && (
          <div className="fee-rate-inline low" title={`Low - Time: ${formatTime(estimate.lowBuckets[0]?.estimatedSeconds, true)}`}>
            <span className="fee-label">L:</span>
            <span className="fee-value">{formatFeeRate(estimate.lowBuckets[0]?.feerate)}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fee-buckets">
      <h4>Network Fee Rates</h4>
      
      {estimate.priorityBucket && (
        <div className="fee-bucket priority">
          <div className="fee-bucket-header">Priority</div>
          <div className="fee-bucket-rate">
            {formatFeeRate(estimate.priorityBucket.feerate)}
          </div>
          <div className="fee-bucket-time">
            {formatTime(estimate.priorityBucket.estimatedSeconds)}
          </div>
        </div>
      )}
      
      {estimate.normalBuckets && estimate.normalBuckets.length > 0 && (
        <div className="fee-bucket normal">
          <div className="fee-bucket-header">Normal</div>
          <div className="fee-bucket-rate">
            {formatFeeRate(estimate.normalBuckets[0]?.feerate)}
          </div>
          <div className="fee-bucket-time">
            {formatTime(estimate.normalBuckets[0]?.estimatedSeconds, true)}
          </div>
        </div>
      )}
      
      {estimate.lowBuckets && estimate.lowBuckets.length > 0 && (
        <div className="fee-bucket low">
          <div className="fee-bucket-header">Low</div>
          <div className="fee-bucket-rate">
            {formatFeeRate(estimate.lowBuckets[0]?.feerate)}
          </div>
          <div className="fee-bucket-time">
            {formatTime(estimate.lowBuckets[0]?.estimatedSeconds, true)}
          </div>
        </div>
      )}
    </div>
  );
}; 