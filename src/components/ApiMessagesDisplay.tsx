import { FC, useState, useEffect } from "react";
import { useWalletStore } from "../store/wallet.store";
import { WalletStorage } from "../utils/wallet-storage";
import { decrypt_message, EncryptedMessage } from "cipher";
import { formatKasAmount } from "../utils/format";

type Transaction = {
  transaction_id: string;
  payload: string;
  block_time: number;
  outputs: Array<{
    amount: number;
    script_public_key_address: string;
  }>;
  inputs: Array<{
    previous_outpoint_address: string;
  }>;
};

type ApiMessagesDisplayProps = {
  address: string;
};

export const ApiMessagesDisplay: FC<ApiMessagesDisplayProps> = ({ address }) => {
  const [messages, setMessages] = useState<Array<{
    transactionId: string;
    senderAddress: string;
    recipientAddress: string;
    timestamp: number;
    content: string;
    amount: number;
    payload: string;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletStore = useWalletStore();

  useEffect(() => {
    if (address && walletStore.unlockedWallet) {
      fetchMessages();
    }
  }, [address, walletStore.unlockedWallet]);

  const fetchMessages = async () => {
    setLoading(true);
    setError(null);
    try {
      // Ensure the address is properly formatted for the API
      const formattedAddress = address.includes(':') 
        ? encodeURIComponent(address)
        : encodeURIComponent(`kaspatest:${address}`);
      
      const apiUrl = `https://api-tn10.kaspa.org/addresses/${formattedAddress}/full-transactions-page?limit=50&before=0&after=0&resolve_previous_outpoints=no`;
      
      console.log("Fetching messages from API URL:", apiUrl);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const transactions: Transaction[] = await response.json();
      console.log("Fetched transactions:", transactions);
      
      // Process transactions and extract messages
      const processedMessages = await Promise.all(
        transactions
          .filter((tx: Transaction) => tx.payload && tx.payload.startsWith("636970685f6d73673a"))
          .map(async (tx: Transaction) => {
            console.log("Processing transaction with payload:", tx.payload);
            
            // For each transaction, determine if this is incoming or outgoing
            const recipientAddress = tx.outputs[0]?.script_public_key_address || "Unknown";
            const isOutgoing = recipientAddress !== address;
            const senderAddress = isOutgoing ? 
              address : 
              (tx.inputs[0]?.previous_outpoint_address || "Unknown");
              
            // Try to decrypt the message
            let decryptedContent = "";
            
            if (walletStore.unlockedWallet) {
              try {
                // Extract the encrypted part (remove the "ciph_msg:" prefix)
                const prefix = "636970685f6d73673a"; // hex for "ciph_msg:"
                const encryptedHex = tx.payload.substring(prefix.length);
                console.log("Attempting to decrypt hex:", encryptedHex);
                
                // Get the private key generator
                const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(
                  walletStore.unlockedWallet,
                  walletStore.unlockedWallet.password
                );
                
                // Try multiple private keys
                const maxKeys = 5; // Try up to 5 keys for each type
                let decryptionSuccess = false;
                
                // First try with receive keys (standard addresses)
                for (let i = 0; i < maxKeys; i++) {
                  try {
                    console.log(`Trying receive key at index ${i}...`);
                    const privateKey = privateKeyGenerator.receiveKey(i);
                    const privateKeyHex = privateKey.toString();
                    console.log(`Got private key string: ${privateKeyHex.substring(0, 8)}...`);
                    
                    // Create EncryptedMessage and attempt to decrypt
                    const encryptedMessage = new EncryptedMessage(encryptedHex);
                    const result = await decrypt_message(encryptedMessage, privateKey);
                    
                    if (result) {
                      decryptedContent = result;
                      decryptionSuccess = true;
                      console.log(`Successfully decrypted with receive key at index ${i}`);
                      break;
                    }
                  } catch (e) {
                    console.log(`Failed to decrypt with receive key at index ${i}:`, e);
                  }
                }
                
                // If still not decrypted, try with change keys
                if (!decryptionSuccess) {
                  for (let i = 0; i < maxKeys; i++) {
                    try {
                      console.log(`Trying change key at index ${i}...`);
                      const privateKey = privateKeyGenerator.changeKey(i);
                      const privateKeyHex = privateKey.toString();
                      console.log(`Got private key string: ${privateKeyHex.substring(0, 8)}...`);
                      
                      // Create EncryptedMessage and attempt to decrypt
                      const encryptedMessage = new EncryptedMessage(encryptedHex);
                      const result = await decrypt_message(encryptedMessage, privateKey);
                      
                      if (result) {
                        decryptedContent = result;
                        decryptionSuccess = true;
                        console.log(`Successfully decrypted with change key at index ${i}`);
                        break;
                      }
                    } catch (e) {
                      console.log(`Failed to decrypt with change key at index ${i}:`, e);
                    }
                  }
                }
                
                if (!decryptionSuccess) {
                  decryptedContent = "[Could not decrypt message]";
                  console.log("Could not decrypt message with any key.");
                }
              } catch (error) {
                console.error("Error decrypting message:", error);
                decryptedContent = "[Decryption error]";
              }
            } else {
              decryptedContent = "[Wallet locked]";
            }
            
            return {
              transactionId: tx.transaction_id,
              senderAddress,
              recipientAddress,
              timestamp: tx.block_time,
              content: decryptedContent,
              amount: tx.outputs[0]?.amount ? tx.outputs[0].amount / 100000000 : 0,
              payload: tx.payload
            };
          })
      );
      
      // Sort messages by timestamp (newest first)
      processedMessages.sort((a, b) => b.timestamp - a.timestamp);
      
      setMessages(processedMessages);
    } catch (err) {
      console.error("Error fetching messages:", err);
      setError(`Error fetching messages: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const shortenAddress = (addr: string) => {
    if (!addr || addr === "Unknown") return "Unknown";
    return `${addr.substring(0, 12)}...${addr.substring(addr.length - 12)}`;
  };

  return (
    <div className="api-messages-display">
      <div className="header">
        <h2>Messages from API</h2>
        <button onClick={fetchMessages} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="messages-list">
        {messages.length === 0 && !loading ? (
          <div className="no-messages">No messages found</div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.transactionId} 
              className={`message ${msg.senderAddress === address ? "outgoing" : "incoming"}`}
            >
              <div className="message-header">
                <span className="message-direction">
                  {msg.senderAddress === address ? "To" : "From"}: {shortenAddress(msg.senderAddress === address ? msg.recipientAddress : msg.senderAddress)}
                </span>
                <span className="message-time">
                  {new Date(msg.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="message-content">{msg.content}</div>
              <div className="message-footer">
                <span className="message-id">
                  <span className="tx-label">TX: </span>
                  <span className="tx-value">{msg.transactionId}</span>
                </span>
                {msg.amount && (
                  <span className="message-amount">{formatKasAmount(msg.amount)} KAS</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}; 