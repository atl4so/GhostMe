import { FC, useState, useEffect, useRef } from "react";
import { Message as MessageType } from "../type/all";
import { decodePayload } from "../utils/all-in-one";
import { formatKasAmount } from "../utils/format";
import { decrypt_message, decrypt_message_with_bytes, decrypt_with_secret_key } from "cipher";
import { useWalletStore } from "../store/wallet.store";
import { WalletStorage } from "../utils/wallet-storage";
import { CipherHelper } from "../utils/cipher-helper";

type MessageDisplayProps = {
  message: MessageType;
  isOutgoing: boolean;
};

export const MessageDisplay: FC<MessageDisplayProps> = ({
  message,
  isOutgoing,
}) => {
  const {
    senderAddress,
    recipientAddress,
    timestamp,
    payload,
    content,
    amount,
    transactionId,
    fileData
  } = message;
  
  const displayAddress = isOutgoing ? recipientAddress : senderAddress;
  const walletStore = useWalletStore();
  const mounted = useRef(true);

  const shortDisplayAddress =
    displayAddress && displayAddress !== "Unknown"
      ? `${displayAddress.substring(0, 12)}...${displayAddress.substring(
          displayAddress.length - 12
        )}`
      : "Unknown";

  const [decryptedContent, setDecryptedContent] = useState<string>("");
  const [decryptionError, setDecryptionError] = useState<string>("");
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [decryptionAttempted, setDecryptionAttempted] = useState<boolean>(false);

  // Parse and render message content
  const renderMessageContent = () => {
    // Wait for decryption attempt before showing content
    if (isDecrypting) {
      return <div className="decrypting">Decrypting message...</div>;
    }

    // Only use decrypted content if decryption was attempted and successful
    let messageToRender = (decryptionAttempted && decryptedContent) || content;
    
    // Handle file/image messages
    if (fileData && fileData.type === 'file') {
      if (fileData.mimeType.startsWith('image/')) {
        return <img src={fileData.content} alt={fileData.name} className="message-image" />;
      }
      return (
        <div className="file-message">
          <div className="file-info">
            📎 {fileData.name} ({Math.round(fileData.size / 1024)}KB)
          </div>
          <button 
            className="download-button"
            onClick={() => {
              const link = document.createElement('a');
              link.href = fileData.content;
              link.download = fileData.name;
              link.click();
            }}
          >
            Download
          </button>
        </div>
      );
    }

    // Try to parse as JSON in case it's a file message in content
    try {
      const parsedContent = JSON.parse(messageToRender);
      if (parsedContent.type === 'file') {
        if (parsedContent.mimeType.startsWith('image/')) {
          return <img key={`img-${transactionId}`} src={parsedContent.content} alt={parsedContent.name} className="message-image" />;
        }
        return (
          <div key={`file-${transactionId}`} className="file-message">
            <div className="file-info">
              📎 {parsedContent.name} ({Math.round((parsedContent.size || 0) / 1024)}KB)
            </div>
            <button 
              className="download-button"
              onClick={() => {
                const link = document.createElement('a');
                link.href = parsedContent.content;
                link.download = parsedContent.name;
                link.click();
              }}
            >
              Download
            </button>
          </div>
        );
      }
    } catch (e) {
      // Not a JSON message, render as text
    }

    return messageToRender;
  };

  useEffect(() => {
    const decryptMessage = async () => {
      if (!mounted.current || !payload || !walletStore.unlockedWallet) {
        setDecryptionAttempted(true);
        return;
      }

      setIsDecrypting(true);
      setDecryptionAttempted(false);

      try {
        // Add a small delay to ensure wallet is fully initialized
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!mounted.current) return;

        // Check if the payload starts with the cipher prefix
        const prefix = "ciph_msg:"
          .split("")
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("");
        
        if (payload.startsWith(prefix)) {
          // Extract the encrypted message hex
          const encryptedHex = CipherHelper.stripPrefix(payload);
          
          // Get the private key generator
          const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(
            walletStore.unlockedWallet,
            walletStore.unlockedWallet.password
          );

          let decrypted: string | null = null;
          
          // Try decryption with receive key first
          try {
            const privateKey = privateKeyGenerator.receiveKey(0);
            decrypted = await CipherHelper.tryDecrypt(
              encryptedHex,
              privateKey.toString(),
              transactionId || `${senderAddress}-${timestamp}`
            );
          } catch (receiveErr) {
            // Try with change key as fallback
            try {
              const changeKey = privateKeyGenerator.changeKey(0);
              decrypted = await CipherHelper.tryDecrypt(
                encryptedHex,
                changeKey.toString(),
                transactionId || `${senderAddress}-${timestamp}`
              );
            } catch (changeErr) {
              throw new Error("Failed to decrypt with both receive and change keys");
            }
          }

          if (mounted.current && decrypted) {
            setDecryptedContent(decrypted);
            setDecryptionError("");
          }
        } else {
          const decoded = decodePayload(payload);
          if (mounted.current) {
            setDecryptedContent(decoded || "");
            setDecryptionError("");
          }
        }
      } catch (error) {
        if (mounted.current) {
          const decoded = decodePayload(payload);
          setDecryptedContent(decoded || "");
          setDecryptionError((error as Error).message || "Failed to decrypt message");
        }
      } finally {
        if (mounted.current) {
          setIsDecrypting(false);
          setDecryptionAttempted(true);
        }
      }
    };

    // Reset states when message changes
    setDecryptedContent("");
    setDecryptionError("");
    setIsDecrypting(false);
    setDecryptionAttempted(false);

    // Start decryption
    decryptMessage();

    // Cleanup function
    return () => {
      mounted.current = false;
    };
  }, [payload, walletStore.unlockedWallet, transactionId, senderAddress, timestamp]);

  // Set mounted ref on component mount
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Add debug log for render
  console.log("MessageDisplay: Rendering message", {
    transactionId,
    content,
    decryptedContent,
    finalContent: decryptedContent || content,
    isOutgoing,
    senderAddress,
    recipientAddress
  });

  return (
    <div className={`message ${isOutgoing ? "outgoing" : "incoming"}`}>
      <div className="message-header">
        <span className="message-from">
          {isOutgoing ? "To" : "From"}: {shortDisplayAddress}
        </span>
        <span className="message-time">
          {timestamp ? new Date(timestamp).toLocaleString() : "Pending"}
        </span>
      </div>
      <div className="message-content">
        {renderMessageContent()}
      </div>
      <div className="message-footer">
        <span className="message-id">
          <span className="tx-label">TX: </span>
          <span className="tx-value">{transactionId || "Pending..."}</span>
        </span>
        {amount > 0 && (
          <span className="message-amount">{formatKasAmount(amount, true)} KAS</span>
        )}
      </div>
    </div>
  );
};