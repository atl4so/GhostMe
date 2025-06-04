import { create } from "zustand";
import { Contact, Message } from "../type/all";
import { encrypt_message, decrypt_message, decrypt_with_secret_key, EncryptedMessage } from "cipher";
import { PrivateKey } from "kaspa-wasm";
import { WalletStorage, UnlockedWallet } from "../utils/wallet-storage";
import { Address, NetworkType } from "kaspa-wasm";

// Helper function to determine network type from address
function getNetworkTypeFromAddress(address: string): NetworkType {
  if (address.startsWith('kaspatest:')) {
    return NetworkType.Testnet;
  } else if (address.startsWith('kaspadev:')) {
    return NetworkType.Devnet;
  }
  return NetworkType.Mainnet;
}

interface MessagingState {
  isLoaded: boolean;
  isCreatingNewChat: boolean;
  contacts: Contact[];
  messages: Message[];
  messagesOnOpenedRecipient: Message[];
  addMessages: (messages: Message[]) => void;
  flushCache: (address: string) => void;
  addContacts: (contacts: Contact[]) => void;
  loadMessages: (address: string) => Message[];
  setIsLoaded: (isLoaded: boolean) => void;
  storeMessage: (message: Message, walletAddress: string) => void;
  exportMessages: (wallet: UnlockedWallet, password: string) => Promise<Blob>;
  importMessages: (file: File, wallet: UnlockedWallet, password: string) => Promise<void>;

  openedRecipient: string | null;
  setOpenedRecipient: (contact: string | null) => void;
  refreshMessagesOnOpenedRecipient: () => void;
  setIsCreatingNewChat: (isCreatingNewChat: boolean) => void;

  connectAccountService: (accountService: any) => void;
}

export const useMessagingStore = create<MessagingState>((set, g) => ({
  isLoaded: false,
  isCreatingNewChat: false,
  openedRecipient: null,
  contacts: [],
  messages: [],
  messagesOnOpenedRecipient: [],
  addContacts: (contacts) => {
    const fullContacts = [...g().contacts, ...contacts];
    fullContacts.sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp
    );
    set({ contacts: [...g().contacts, ...contacts] });
  },
  addMessages: (messages) => {
    const fullMessages = [...g().messages, ...messages];
    fullMessages.sort((a, b) => a.timestamp - b.timestamp);

    set({ messages: fullMessages });

    g().refreshMessagesOnOpenedRecipient();
  },
  flushCache: (address: string) => {
    const messagesMap = JSON.parse(
      localStorage.getItem("kaspa_messages_by_wallet") || "{}"
    );
    if (address) {
      delete messagesMap[address];
    }
    localStorage.setItem(
      "kaspa_messages_by_wallet",
      JSON.stringify(messagesMap)
    );
  },
  loadMessages: (address): Message[] => {
    const messages: Record<string, Message[]> = JSON.parse(
      localStorage.getItem("kaspa_messages_by_wallet") || "{}"
    );

    const contacts = new Map();

    // Process messages and organize by conversation
    messages[address]?.forEach((msg) => {
      // Ensure fileData is properly loaded if it exists
      if (msg.fileData) {
        msg.content = `[File: ${msg.fileData.name}]`;
      }

      const otherParty =
        msg.senderAddress === address
          ? msg.recipientAddress
          : msg.senderAddress;

      if (!contacts.has(otherParty)) {
        contacts.set(otherParty, {
          address: otherParty,
          lastMessage: msg,
          messages: [],
        });
      }

      const contact = contacts.get(otherParty);
      contact.messages.push(msg);
      
      // Update last message if this message is more recent
      if (msg.timestamp > contact.lastMessage.timestamp) {
        contact.lastMessage = msg;
      }
    });

    // Sort messages within each contact by timestamp
    contacts.forEach(contact => {
      contact.messages.sort((a: Message, b: Message) => a.timestamp - b.timestamp);
    });

    // Update state with sorted contacts and messages
    const sortedContacts = [...contacts.values()].sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp
    );

    set({
      contacts: sortedContacts,
      messages: (messages[address] || []).sort(
        (a: Message, b: Message) => a.timestamp - b.timestamp
      ),
    });

    // Refresh the currently opened conversation
    g().refreshMessagesOnOpenedRecipient();

    return g().messages;
  },
  storeMessage: (message: Message, walletAddress: string) => {
    const messagesMap = JSON.parse(
      localStorage.getItem("kaspa_messages_by_wallet") || "{}"
    );
    if (!messagesMap[walletAddress]) {
      messagesMap[walletAddress] = [];
    }

    // Check if we already have a message with this transaction ID
    const existingMessageIndex = messagesMap[walletAddress].findIndex(
      (m: Message) => m.transactionId === message.transactionId
    );

    if (existingMessageIndex !== -1) {
      // Merge the messages, preferring non-empty values
      const existingMessage = messagesMap[walletAddress][existingMessageIndex];
      const mergedMessage = {
        ...message,
        content: message.content || existingMessage.content,
        payload: message.payload || existingMessage.payload,
        // Use the earliest timestamp if both exist
        timestamp: Math.min(message.timestamp, existingMessage.timestamp),
        // Preserve fileData if it exists in either message
        fileData: message.fileData || existingMessage.fileData,
        // Ensure we have both addresses
        senderAddress: message.senderAddress || existingMessage.senderAddress,
        recipientAddress: message.recipientAddress || existingMessage.recipientAddress
      };
      messagesMap[walletAddress][existingMessageIndex] = mergedMessage;
    } else {
      // For outgoing messages with file content, try to parse and store fileData
      if (!message.fileData && message.content) {
        try {
          const parsedContent = JSON.parse(message.content);
          if (parsedContent.type === 'file') {
            message.fileData = {
              type: parsedContent.type,
              name: parsedContent.name,
              size: parsedContent.size,
              mimeType: parsedContent.mimeType,
              content: parsedContent.content
            };
          }
        } catch (e) {
          // Not a file message, ignore
        }
      }
      // Add new message
      messagesMap[walletAddress].push(message);
    }

    localStorage.setItem(
      "kaspa_messages_by_wallet",
      JSON.stringify(messagesMap)
    );

    // Update contacts and conversations
    const state = g();
    const otherParty = message.senderAddress === walletAddress ? 
      message.recipientAddress : message.senderAddress;

    // Update or create contact
    const existingContactIndex = state.contacts.findIndex(c => c.address === otherParty);
    if (existingContactIndex !== -1) {
      // Update existing contact
      const updatedContact = {
        ...state.contacts[existingContactIndex],
        lastMessage: message,
        messages: [...state.contacts[existingContactIndex].messages, message]
      };
      const newContacts = [...state.contacts];
      newContacts[existingContactIndex] = updatedContact;
      set({ contacts: newContacts });
    } else {
      // Create new contact
      const newContact = {
        address: otherParty,
        lastMessage: message,
        messages: [message]
      };
      set({ contacts: [...state.contacts, newContact] });
    }

    // Sort contacts by most recent message
    const sortedContacts = [...g().contacts].sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp
    );
    set({ contacts: sortedContacts });
  },
  setIsLoaded: (isLoaded) => {
    set({ isLoaded });
  },
  setOpenedRecipient(contact) {
    set({ openedRecipient: contact });

    g().refreshMessagesOnOpenedRecipient();
  },
  refreshMessagesOnOpenedRecipient: () => {
    const { openedRecipient, messagesOnOpenedRecipient } = g();

    if (!openedRecipient) {
      if (messagesOnOpenedRecipient.length) {
        set({ messagesOnOpenedRecipient: [] });
      }
      return;
    }

    const messages = g().messages.filter((msg) => {
      return (
        msg.senderAddress === openedRecipient ||
        msg.recipientAddress === openedRecipient
      );
    });

    set({ messagesOnOpenedRecipient: messages });
  },
  setIsCreatingNewChat: (isCreatingNewChat) => {
    set({ isCreatingNewChat });

    if (isCreatingNewChat) {
      set({ openedRecipient: null, messagesOnOpenedRecipient: [] });
    }
  },
  exportMessages: async (wallet, password) => {
    try {
      console.log("Starting message export process...");
      
      const messagesMap = JSON.parse(
        localStorage.getItem("kaspa_messages_by_wallet") || "{}"
      );
      
      // Create backup object with metadata
      const backup = {
        version: "1.0",
        timestamp: Date.now(),
        type: "kaspa-messages-backup",
        data: messagesMap
      };

      console.log("Getting private key generator...");
      const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(wallet, password);
      
      console.log("Getting receive key...");
      const receiveKey = privateKeyGenerator.receiveKey(0);
      
      // Get the current network type from the first message's address
      let networkType = NetworkType.Testnet; // Default to testnet
      const addresses = Object.keys(messagesMap);
      if (addresses.length > 0) {
        networkType = getNetworkTypeFromAddress(addresses[0]);
      }
      console.log("Using network type:", networkType);
      
      const receiveAddress = receiveKey.toAddress(networkType);
      console.log("Using receive address:", receiveAddress.toString());
      
      console.log("Converting backup to string...");
      const backupStr = JSON.stringify(backup);
      
      console.log("Encrypting backup data...");
      try {
        const encryptedData = await encrypt_message(
          receiveAddress.toString(),
          backupStr
        );
        
        // Create a Blob with the encrypted data wrapped in JSON
        const backupFile = {
          type: "kaspa-messages-backup",
          data: encryptedData.to_hex()
        };
        
        const blob = new Blob(
          [JSON.stringify(backupFile)],
          { type: "application/json" }
        );
        
        return blob;
      } catch (error: unknown) {
        console.error("Detailed export error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Failed to create backup: ${errorMessage}`);
      }
    } catch (error: unknown) {
      console.error("Error exporting messages:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to create backup: ${errorMessage}`);
    }
  },
  importMessages: async (file, wallet, password) => {
    try {
      console.log("Starting import process...");
      
      // Read and parse file content
      const fileContent = await file.text();
      console.log("Parsing backup file...");
      const backupFile = JSON.parse(fileContent);
      
      // Validate backup file format
      if (!backupFile.type || backupFile.type !== "kaspa-messages-backup" || !backupFile.data) {
        throw new Error("Invalid backup file format");
      }
      
      console.log("Getting private key for decryption...");
      const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(wallet, password);
      const privateKey = privateKeyGenerator.receiveKey(0);
      
      // Get private key bytes
      const privateKeyBytes = WalletStorage.getPrivateKeyBytes(privateKey);
      if (!privateKeyBytes) {
        throw new Error("Failed to get private key bytes");
      }
      
      console.log("Creating EncryptedMessage from hex...");
      const encryptedMessage = new EncryptedMessage(backupFile.data);
      
      console.log("Decrypting backup data...");
      const decryptedStr = await decrypt_with_secret_key(encryptedMessage, privateKeyBytes);
      
      console.log("Parsing decrypted data...");
      const decryptedData = JSON.parse(decryptedStr);
      
      // Validate decrypted data structure
      if (!decryptedData.version || !decryptedData.type || !decryptedData.data) {
        throw new Error("Invalid backup data structure");
      }
      
      console.log("Merging with existing messages...");
      // Merge with existing messages
      const existingMessages = JSON.parse(
        localStorage.getItem("kaspa_messages_by_wallet") || "{}"
      );
      
      const mergedMessages = {
        ...existingMessages,
        ...decryptedData.data
      };
      
      // Save merged messages
      localStorage.setItem(
        "kaspa_messages_by_wallet",
        JSON.stringify(mergedMessages)
      );
      
      console.log("Reloading messages...");
      // Determine network type from existing messages
      let networkType = NetworkType.Testnet; // Default to testnet
      const addresses = Object.keys(mergedMessages);
      if (addresses.length > 0) {
        networkType = getNetworkTypeFromAddress(addresses[0]);
      }
      console.log("Using network type:", networkType);
      
      // Get the current address from the private key using detected network type
      const receiveAddress = privateKey.toAddress(networkType);
      const currentAddress = receiveAddress.toString();
      console.log("Using receive address:", currentAddress);
      
      // Reload messages using the current address
      g().loadMessages(currentAddress);
      
      console.log("Import completed successfully");
    } catch (error: unknown) {
      console.error("Error importing messages:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to import messages: ${error.message}`);
      }
      throw new Error("Failed to import messages: Unknown error");
    }
  },
  connectAccountService: (accountService) => {
    // Make the store available globally for the account service
    (window as any).messagingStore = g();
    
    // Listen for new messages from the account service
    accountService.on("messageReceived", (message: Message) => {
      const state = g();
      
      // Store the message
      state.storeMessage(message, message.senderAddress);
      
      // Add the message to our state
      state.addMessages([message]);
      
      // Refresh the UI if this message is for the currently opened chat
      if (state.openedRecipient === message.senderAddress || 
          state.openedRecipient === message.recipientAddress) {
        state.refreshMessagesOnOpenedRecipient();
      }
      
      // Update contacts if needed
      const otherParty = message.senderAddress === state.openedRecipient 
        ? message.recipientAddress 
        : message.senderAddress;
        
      const existingContact = state.contacts.find(c => c.address === otherParty);
      if (!existingContact) {
        state.addContacts([{
          address: otherParty,
          lastMessage: message,
          messages: [message]
        }]);
      }
    });
  },
}));
