import { FC, useState, useEffect } from "react";
import { useWalletStore } from "../store/wallet.store";
import { useMessagingStore } from "../store/messaging.store";
import { WalletStorage } from "../utils/wallet-storage";
import { decrypt_message, EncryptedMessage } from "cipher";
import { Transaction } from "../type/all";
import { getApiEndpoint } from "../config/nodes";
import "./FetchApiMessages.css";

type FetchApiMessagesProps = {
  address: string;
};

export const FetchApiMessages: FC<FetchApiMessagesProps> = ({ address }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletStore = useWalletStore();
  const messageStore = useMessagingStore();

  useEffect(() => {
    if (address && walletStore.unlockedWallet) {
      fetchAndProcessMessages();
    }
  }, [address, walletStore.unlockedWallet]);

  const fetchAndProcessMessages = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get the current network from the wallet store
      const networkId = walletStore.selectedNetwork;
      const baseUrl = getApiEndpoint(networkId);
      
      // Ensure the address is properly formatted for the API
      const formattedAddress = address.includes(':') 
        ? encodeURIComponent(address)
        : encodeURIComponent(`${networkId === 'mainnet' ? 'kaspa:' : 'kaspatest:'}${address}`);
      
      const apiUrl = `${baseUrl}/addresses/${formattedAddress}/full-transactions-page?limit=50&before=0&after=0&resolve_previous_outpoints=no`;
      
      console.log("API Messages: Fetching from URL:", apiUrl);
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const transactions: Transaction[] = await response.json();
      console.log(`API Messages: Fetched ${transactions.length} transactions`);
      
      // Load existing messages to avoid duplicates
      const existingMessages = messageStore.loadMessages(address);
      const existingTxIds = new Set(
        existingMessages.map(msg => msg.transactionId)
      );
      
      // Process only encrypted message transactions
      const messageTxs = transactions.filter(tx => 
        tx.payload && tx.payload.startsWith("636970685f6d73673a")
      );
      
      console.log(`API Messages: Found ${messageTxs.length} encrypted message transactions`);
      
      // Process each transaction
      for (const tx of messageTxs) {
        // Skip if we already have this transaction
        if (existingTxIds.has(tx.transaction_id)) {
          console.log(`API Messages: Skipping existing transaction: ${tx.transaction_id}`);
          continue;
        }
        
        console.log(`API Messages: Processing new transaction: ${tx.transaction_id}`);
        
        // For each transaction, determine if this is incoming or outgoing
        const recipientAddress = tx.outputs[0]?.script_public_key_address || "Unknown";
        const isIncoming = recipientAddress === address;
        const senderAddress = isIncoming ? 
          (tx.inputs[0]?.previous_outpoint_address || "Unknown") : 
          address;
          
        // Try to decrypt the message
        let decryptedContent = "";
        
        if (walletStore.unlockedWallet) {
          try {
            // Extract the encrypted part (remove the "ciph_msg:" prefix)
            const prefix = "636970685f6d73673a"; // hex for "ciph_msg:"
            const encryptedHex = tx.payload.substring(prefix.length);
            console.log(`API Messages: Attempting to decrypt message: ${encryptedHex.substring(0, 20)}...`);
            
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
                console.log(`API Messages: Trying receive key at index ${i}`);
                const privateKey = privateKeyGenerator.receiveKey(i);
                
                // Create EncryptedMessage and attempt to decrypt
                const encryptedMessage = new EncryptedMessage(encryptedHex);
                const result = await decrypt_message(encryptedMessage, privateKey);
                
                if (result) {
                  decryptedContent = result;
                  decryptionSuccess = true;
                  console.log(`API Messages: Successfully decrypted with receive key at index ${i}`);
                  break;
                }
              } catch (e) {
                console.log(`API Messages: Failed to decrypt with receive key at index ${i}`);
              }
            }
            
            // If still not decrypted, try with change keys
            if (!decryptionSuccess) {
              for (let i = 0; i < maxKeys; i++) {
                try {
                  console.log(`API Messages: Trying change key at index ${i}`);
                  const privateKey = privateKeyGenerator.changeKey(i);
                  
                  // Create EncryptedMessage and attempt to decrypt
                  const encryptedMessage = new EncryptedMessage(encryptedHex);
                  const result = await decrypt_message(encryptedMessage, privateKey);
                  
                  if (result) {
                    decryptedContent = result;
                    decryptionSuccess = true;
                    console.log(`API Messages: Successfully decrypted with change key at index ${i}`);
                    break;
                  }
                } catch (e) {
                  console.log(`API Messages: Failed to decrypt with change key at index ${i}`);
                }
              }
            }
            
            if (!decryptionSuccess) {
              console.log(`API Messages: Could not decrypt message for transaction ${tx.transaction_id}`);
              decryptedContent = "[Could not decrypt message]";
            }
          } catch (error) {
            console.error("API Messages: Error decrypting message:", error);
            decryptedContent = "[Decryption error]";
          }
        }
        
        // Create message data and store it
        const messageData = {
          transactionId: tx.transaction_id,
          senderAddress: senderAddress,
          recipientAddress: recipientAddress,
          timestamp: tx.block_time,
          payload: tx.payload,
          amount: tx.outputs[0]?.amount || 0,
          content: decryptedContent,
        };
        
        console.log(`API Messages: Storing message:`, messageData);
        
        // Store the message
        messageStore.storeMessage(messageData, address);
      }
      
      // Update UI with all messages
      messageStore.loadMessages(address);
      
      console.log("API Messages: Fetch and process completed successfully");
      
    } catch (err) {
      console.error("API Messages: Error fetching and processing:", err);
      setError(`Error fetching messages: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="api-messages-button">
      <button 
        onClick={fetchAndProcessMessages} 
        disabled={loading}
        title={error ? `Error: ${error}` : "Fetch latest messages from blockchain"}
      >
        {loading ? "Loading..." : "Refresh Messages"}
      </button>
      {error && <div className="api-error-tooltip">{error}</div>}
    </div>
  );
}; 