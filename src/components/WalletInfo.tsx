import { FC, useMemo, useState } from "react";
import { formatKasAmount } from "../utils/format";
import { FeeBuckets } from "./FeeBuckets";
import { useWalletStore } from "../store/wallet.store";

type WalletInfoProps = {
  state: "connected" | "detected" | "not-detected";
  address?: string;
  balance?: {
    mature: number;
    pending: number;
    outgoing: number;
    matureUtxoCount: number;
    pendingUtxoCount: number;
  } | null;
  isWalletReady?: boolean;
};

// @TODO: finish to plug other infos
export const WalletInfo: FC<WalletInfoProps> = ({
  state,
  address,
  balance,
  isWalletReady
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isAccountServiceRunning = useWalletStore(state => state.isAccountServiceRunning);
  const walletBalance = useWalletStore(state => state.balance);

  const walletInfoNode = useMemo(() => {
    // Only show initialization state if the service isn't running
    const isInitializing = !isAccountServiceRunning;
    
    // Use the wallet store's balance as the source of truth
    const currentBalance = walletBalance;
    
    return (
      <>
        <h3>Wallet Information</h3>
        <p>
          <strong>Address:</strong> <span className="address">{address}</span>
        </p>
        <div className="balance-info">
          <h4>Balance</h4>
          {isInitializing ? (
            <p>Click "Start Wallet Service" to load your balance and start messaging.</p>
          ) : (
          <ul className="balance-list">
            <li>
              <strong>Total:</strong>{" "}
              <span className="amount">
                  {formatKasAmount(currentBalance?.mature ?? 0)} KAS
              </span>
            </li>
            <li>
              <strong>Confirmed:</strong>{" "}
                <span className="amount">
                  {formatKasAmount(currentBalance?.mature ?? 0)} KAS
                </span>
            </li>
            <li>
              <strong>Unconfirmed:</strong>{" "}
              <span className="amount">
                  {formatKasAmount(currentBalance?.pending ?? 0)} KAS
                </span>
              </li>
              <li>
                <strong>Outgoing:</strong>{" "}
                <span className="amount">
                  {formatKasAmount(currentBalance?.outgoing ?? 0)} KAS
              </span>
            </li>
          </ul>
          )}
        </div>
        <div className="balance-info">
          <h4>UTXO Information</h4>
          {isInitializing ? (
            <p>Waiting for wallet service to start...</p>
          ) : (
          <ul className="balance-list">
            <li>
              <strong>Mature UTXOs:</strong>{" "}
                <span className="utxo-count">{currentBalance?.matureUtxoCount ?? '-'}</span>
              </li>
              <li>
                <strong>Pending UTXOs:</strong>{" "}
                <span className="utxo-count">{currentBalance?.pendingUtxoCount ?? '-'}</span>
            </li>
            <li>
              <strong>Status:</strong>{" "}
                <span className="status">{!currentBalance?.matureUtxoCount ? 'Initializing...' : 'Ready'}</span>
            </li>
          </ul>
          )}
        </div>
      </>
    );
  }, [address, walletBalance, isAccountServiceRunning]);

  if (!isWalletReady) return null;

  return (
    <div className="wallet-info-container">
      <div className="wallet-info-wrapper">
        <FeeBuckets inline={true} />
      <button 
        className="wallet-info-button"
        onClick={() => setIsOpen(true)}
      >
        Wallet Info
      </button>
      </div>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="close-button" onClick={() => setIsOpen(false)}>×</button>
            <div className="modal-body">
              {state === "connected" ? (
                walletInfoNode
              ) : state === "detected" ? (
                <p>
                  KasWare Wallet detected. Click "Connect to Kasware" to view your
                  transactions.
                </p>
              ) : (
                "Kasware Wallet not detected. Please install Kasware Wallet."
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
