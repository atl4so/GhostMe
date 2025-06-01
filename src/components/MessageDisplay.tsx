import { FC, useState, useEffect } from "react";
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

  const shortDisplayAddress =
    displayAddress && displayAddress !== "Unknown"
      ? `${displayAddress.substring(0, 12)}...${displayAddress.substring(
          displayAddress.length - 12
        )}`
      : "Unknown";

  const [decryptedContent, setDecryptedContent] = useState<string>("");
  const [decryptionError, setDecryptionError] = useState<string>("");

  // Parse and render message content
  const renderMessageContent = () => {
    let messageToRender = decryptedContent || content;
    
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
          return <img src={parsedContent.content} alt={parsedContent.name} className="message-image" />;
        }
        return (
          <div className="file-message">
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
      if (!payload || !walletStore.unlockedWallet) return;

      try {
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

          // Try decryption with receive key first
          try {
            const privateKey = privateKeyGenerator.receiveKey(0);
            const decrypted = await CipherHelper.tryDecrypt(
              encryptedHex,
              privateKey.toString(),
              transactionId || `${senderAddress}-${timestamp}`
            );
            setDecryptedContent(decrypted);
            setDecryptionError("");
            return;
          } catch (receiveErr) {
            CipherHelper.log("Failed to decrypt with receive key:", receiveErr);
            
            // Try with change key as fallback
            try {
              const changeKey = privateKeyGenerator.changeKey(0);
              const decrypted = await CipherHelper.tryDecrypt(
                encryptedHex,
                changeKey.toString(),
                transactionId || `${senderAddress}-${timestamp}`
              );
              setDecryptedContent(decrypted);
              setDecryptionError("");
              return;
            } catch (changeErr) {
              CipherHelper.error("Failed to decrypt with change key:", changeErr);
              throw new Error("Failed to decrypt with both receive and change keys");
            }
          }
        } else {
          // If not encrypted, use the regular decodePayload
          CipherHelper.log("Message not encrypted with cipher prefix, using regular decodePayload");
          const decoded = decodePayload(payload);
          setDecryptedContent(decoded || "");
          setDecryptionError("");
        }
      } catch (error) {
        CipherHelper.error("Error in decryption process:", error);
        const decoded = decodePayload(payload);
        setDecryptedContent(decoded || "");
        setDecryptionError((error as Error).message || "Failed to decrypt message");
      }
    };

    decryptMessage();
  }, [payload, walletStore.unlockedWallet, transactionId, senderAddress, timestamp]);

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
