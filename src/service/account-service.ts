import {
  Address,
  Generator,
  kaspaToSompi,
  PaymentOutput,
  PendingTransaction,
  UtxoContext,
  UtxoProcessor,
  UtxoProcessorEvent,
  UtxoProcessorEventMap,
  IBalanceEvent,
  IPendingEvent,
  IMaturityEvent,
  Balance,
  UtxoEntry,
  IUtxosChanged,
  IBlockAdded,
  ITransaction,
  NetworkType,
} from "kaspa-wasm";
import { KaspaClient, decodePayload } from "../utils/all-in-one";
import { UnlockedWallet, WalletStorage } from "../utils/wallet-storage";
import EventEmitter from "eventemitter3";
import { encrypt_message } from "cipher";
import { CipherHelper } from "../utils/cipher-helper";

// Message related types
type DecodedMessage = {
  transactionId: string;
  senderAddress: string;
  recipientAddress: string;
  timestamp: number;
  content: string;
  amount: number;
  payload: string;
  fileData?: {
    type: string;
    name: string;
    size: number;
    mimeType: string;
    content: string;
  };
};

// strictly typed events
type AccountServiceEvents = {
  balance: (balance: {
    mature: number;
    pending: number;
    outgoing: number;
    matureUtxoCount: number;
    pendingUtxoCount: number;
  }) => void;
  utxosChanged: (utxos: UtxoEntry[]) => void;
  transactionReceived: (transaction: any) => void;
  messageReceived: (message: DecodedMessage) => void;
};

type CreateTransactionArgs = {
  address: Address;
  amount: bigint;
  payload: string;
};

type SendMessageArgs = {
  toAddress: Address;
  message: string;
  password: string;
};

// Add this helper function at the top level
function stringifyWithBigInt(obj: any): string {
  return JSON.stringify(obj, (_, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
}

export class AccountService extends EventEmitter<AccountServiceEvents> {
  processor: UtxoProcessor;
  context: UtxoContext;
  networkId: string;

  // only populated when started
  isStarted: boolean = false;
  receiveAddress: Address | null = null;

  private processedMessageIds: Set<string> = new Set();
  private readonly MESSAGE_PREFIX_HEX = "636970685f6d73673a"; // "ciph_msg:" in hex
  private readonly MAX_PROCESSED_MESSAGES = 1000; // Prevent unlimited growth
  private readonly MESSAGE_AMOUNT = BigInt(10000000); // 0.1 KAS in sompi

  // Add password field
  private password: string | null = null;

  constructor(
    private readonly rpcClient: KaspaClient,
    private readonly unlockedWallet: UnlockedWallet
  ) {
    super();

    if (!rpcClient.rpc) {
      throw new Error("RPC client is not initialized");
    }

    this.networkId = rpcClient.networkId;

    this.processor = new UtxoProcessor({
      networkId: this.networkId,
      rpc: rpcClient.rpc,
    });
    this.context = new UtxoContext({ processor: this.processor });

    // Set password from unlocked wallet if available
    if (unlockedWallet.password) {
      this.password = unlockedWallet.password;
    }
  }

  // Add method to set password
  public setPassword(password: string) {
    if (!password) {
      throw new Error("Password cannot be empty");
    }
    console.log("Setting password in AccountService");
    this.password = password;
  }

  // Add method to check if password is set
  private ensurePasswordSet() {
    if (!this.password) {
      throw new Error("Password not set - cannot perform operation");
    }
  }

  private async _emitBalanceUpdate() {
    const balance = await this.context.balance;
    if (!balance) return;

    // Get UTXOs for counting
    const matureUtxos = this.context.getMatureRange(0, this.context.matureLength);
    const pendingUtxos = this.context.getPending();

    // Convert balance values from sompi to KAS
    const matureKAS = Number(balance.mature) / 100000000;
    const pendingKAS = Number(balance.pending) / 100000000;
    const outgoingKAS = Number(balance.outgoing) / 100000000;

    console.log("Balance update (in KAS):", {
      mature: matureKAS,
      pending: pendingKAS,
      outgoing: outgoingKAS,
      matureUtxoCount: matureUtxos.length,
      pendingUtxoCount: pendingUtxos.length,
      rawMature: balance.mature.toString(),
      rawPending: balance.pending.toString(),
      rawOutgoing: balance.outgoing.toString()
    });

    this.emit("balance", {
      mature: matureKAS,
      pending: pendingKAS,
      outgoing: outgoingKAS,
      matureUtxoCount: matureUtxos.length,
      pendingUtxoCount: pendingUtxos.length
    });
  }

  private async _fetchTransactionDetails(txId: string) {
    const maxRetries = 10; // Increased to 10 attempts
    const retryDelay = 2000; // Changed to 2 seconds between retries

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const baseUrl = this.networkId === 'mainnet' ? 'https://api.kaspa.org' : 'https://api-tn10.kaspa.org';
        const response = await fetch(`${baseUrl}/transactions/${txId}?inputs=true&outputs=true&resolve_previous_outpoints=no`);
        
        if (response.status === 404) {
          console.log(`Transaction ${txId} not yet available in API (attempt ${attempt + 1}/${maxRetries}), retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch transaction details: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`Successfully fetched transaction details for ${txId} on attempt ${attempt + 1}`);
        return result;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.error(`Error fetching transaction details for ${txId} after ${maxRetries} attempts:`, error);
          return null;
        }
        console.log(`Attempt ${attempt + 1}/${maxRetries} failed, retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    return null;
  }

  private async fetchHistoricalMessages() {
    if (!this.receiveAddress) return;

    try {
      console.log("Fetching historical messages...");
      const address = this.receiveAddress.toString();

      // Use the network-appropriate API endpoint
      const baseUrl = this.networkId === 'mainnet' ? 'https://api.kaspa.org' : 'https://api-tn10.kaspa.org';
      const response = await fetch(`${baseUrl}/addresses/${address}/transactions`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch historical transactions: ${response.statusText}`);
      }

      const data = await response.json();
      const transactions = data.transactions || [];

      console.log(`Found ${transactions.length} historical transactions`);

      // Process each transaction
      for (const tx of transactions) {
        const txId = tx.transactionId;
        if (!txId || this.processedMessageIds.has(txId)) continue;

        // Check if this is a message transaction and involves our address
        if (this.isMessageTransaction(tx) && this.isTransactionForUs(tx)) {
          await this.processMessageTransaction(tx, txId, Number(tx.blockTime));
        }
      }

      console.log("Historical message fetch complete");
    } catch (error) {
      console.error("Error fetching historical messages:", error);
    }
  }

  private async _onUtxoChanged(notification: IUtxosChanged) {
    console.log("Processing UTXO change:", notification);

    // Get all mature UTXOs for the UTXO update event
    const utxos = this.context.getMatureRange(0, this.context.matureLength);
    
    // Log UTXO details for debugging
    console.log("Current UTXOs:", utxos.map(utxo => ({
      transactionId: utxo.outpoint.transactionId,
      amount: Number(utxo.entry.amount) / 100000000,
      amountSompi: utxo.entry.amount.toString(),
      scriptPublicKey: utxo.entry.scriptPublicKey.toString(),
      isMature: true // Since we got it from getMatureRange
    })));
    
    // Emit the balance update
    this._emitBalanceUpdate();
    
    // Calculate total amount in sompi first, then convert to KAS
    const totalSompi = utxos.reduce((sum, utxo) => sum + utxo.entry.amount, BigInt(0));
    const totalKAS = Number(totalSompi) / 100000000;
    
    // Emit UTXO update
    console.log("UTXOs updated:", {
      count: utxos.length,
      matureLength: this.context.matureLength,
      totalAmount: totalKAS
    });
    this.emit("utxosChanged", utxos);
  }

  async start() {
    try {
      // Get the receive address from the wallet
      const initialReceiveAddress = this.unlockedWallet.publicKeyGenerator.receiveAddress(
        this.networkId,
        0
      );

      // Ensure it has the proper network prefix
      this.receiveAddress = this.ensureAddressPrefix(initialReceiveAddress);
      
      console.log("Using primary address for all operations:", this.receiveAddress.toString());

      // Initialize UTXO processor first
      console.log("Starting UTXO processor...");
      await this.processor.start();

      // Set up event listeners before doing anything else
      console.log("Setting up event listeners...");
      
      // Set up balance change listener
      this.processor.addEventListener("balance", async () => {
        console.log("Balance event received");
        await this._emitBalanceUpdate();
      });

      // Set up maturity change listener
      this.processor.addEventListener("maturity", async () => {
        console.log("Maturity event received");
        await this._emitBalanceUpdate();
      });

      // Set up pending change listener
      this.processor.addEventListener("pending", async () => {
        console.log("Pending event received");
        await this._emitBalanceUpdate();
      });

      // Only track primary address
      const addressesToTrack = [this.receiveAddress!];
      const addressStrings = addressesToTrack.map(addr => addr.toString());

      // First, get initial UTXOs from RPC
      console.log("Fetching initial UTXOs...");
      const utxoResponse = await this.rpcClient.rpc?.getUtxosByAddresses(addressStrings);
      
      if (utxoResponse && utxoResponse.entries && utxoResponse.entries.length > 0) {
        console.log(`Found ${utxoResponse.entries.length} initial UTXOs from RPC`);
      } else {
        console.log("No initial UTXOs found from RPC");
      }

      // Now track addresses in UTXO processor
      console.log("Starting address tracking for primary address...");
      await this.context.trackAddresses(addressesToTrack);

      // Set up block subscription with optimized message handling
      console.log("Setting up block subscription...");
      await this.rpcClient.subscribeToBlockAdded(async (event) => {
        try {
          console.log("Processing block event:", stringifyWithBigInt(event));
          
          const blockTime = Number(event?.data?.block?.header?.timestamp) || Date.now();
          const blockHash = event?.data?.block?.header?.hash;
          
          // Process transactions if they exist
          const transactions = event?.data?.block?.transactions || [];
          
          for (const tx of transactions) {
            const txId = tx.verboseData?.transactionId;
            if (!txId) continue; // Skip if no transaction ID
            
            // Skip if we've already processed this message
            if (this.processedMessageIds.has(txId)) {
              continue;
            }

            // Check if this is a message transaction and involves our address
            if (this.isMessageTransaction(tx) && this.isTransactionForUs(tx)) {
              await this.processMessageTransaction(tx, blockHash || txId, blockTime);
            }
          }
        } catch (error) {
          console.error("Error processing block event:", error);
        }
      });
      console.log("Successfully subscribed to block events");

      // Fetch historical messages after setup is complete
      await this.fetchHistoricalMessages();

      // Get initial state one more time to ensure we're up to date
      await this._emitBalanceUpdate();

      this.isStarted = true;
    } catch (error) {
      console.error("Failed to start account service:", error);
      throw error;
    }
  }

  async stop() {
    console.log("Stopping UTXO subscription and processor...");
    try {
      // Stop the UTXO processor
      await this.processor.stop();
      
      // Clean up our local state
      this.isStarted = false;
      console.log("Successfully cleaned up UTXO subscription and processor");
    } catch (error) {
      console.error("Failed to clean up UTXO subscription and processor:", error);
    }
  }

  public async createTransaction(
    transaction: CreateTransactionArgs,
    password: string
  ) {
    if (!this.isStarted || !this.rpcClient.rpc) {
      throw new Error("Account service is not started");
    }

    console.log("=== CREATING TRANSACTION ===");
    const primaryAddress = this.receiveAddress!;
    console.log("Creating transaction from primary address:", primaryAddress.toString());
    console.log("Change will go back to primary address:", primaryAddress.toString());
    console.log(`Destination: ${transaction.address.toString()}`);
    console.log(`Amount: ${Number(transaction.amount) / 100000000} KAS (${transaction.amount} sompi)`);
    console.log(`Payload length: ${transaction.payload.length / 2} bytes`);

    const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(
      this.unlockedWallet,
      password
    );

    // Ensure the destination address has the proper prefix
    const destinationAddress = this.ensureAddressPrefix(transaction.address);

    const paymentOutput = new PaymentOutput(
      destinationAddress,
      transaction.amount
    );

    const generator = new Generator({
      changeAddress: primaryAddress, // Use primary address for change
      entries: this.context,
      outputs: [paymentOutput],
      payload: transaction.payload,
      priorityFee: BigInt(0),
      networkId: this.networkId,
    });

    try {
      console.log("Generating transaction...");
      const pendingTransaction: PendingTransaction | null =
        await generator.next();

      if ((await generator.next()) !== null) {
        throw new Error("Unexpected multiple transaction generation");
      }

      if (!pendingTransaction) {
        throw new Error("should not happens");
      }

      // Log the addresses that need signing
      const addressesToSign = pendingTransaction.addresses();
      console.log(`Transaction requires signing ${addressesToSign.length} addresses:`);
      addressesToSign.forEach((addr, i) => {
        console.log(`  Address ${i+1}: ${addr.toString()}`);
      });

      // Always use receive key for all addresses since we only use primary address
      const privateKeys = pendingTransaction
        .addresses()
        .map(() => {
          console.log("Using primary address key for signing");
          return privateKeyGenerator.receiveKey(0);
        });

      // Sign the transaction
      console.log("Signing transaction...");
      pendingTransaction.sign(privateKeys);

      // Submit the transaction
      console.log("Submitting transaction to network...");
      const txId = await pendingTransaction.submit(this.rpcClient.rpc);
      console.log(`Transaction submitted with ID: ${txId}`);
      console.log("========================");

      return txId;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  public async estimateTransaction(transaction: CreateTransactionArgs) {
    if (!this.isStarted) {
      throw new Error("Account service is not started");
    }

    return this._getGeneratorForTransaction(transaction).estimate();
  }

  public async estimateTransactionDetails(transaction: CreateTransactionArgs) {
    if (!this.isStarted) {
      throw new Error("Account service is not started");
    }

    try {
      if (!transaction || !transaction.address) {
        throw new Error("Invalid transaction or address");
      }
      
      const availableUtxos = this.context.getMatureRange(0, this.context.matureLength);
      
      const generator = new Generator({
        changeAddress: this.receiveAddress!,
        entries: this.context,
        outputs: [new PaymentOutput(transaction.address, transaction.amount)],
        payload: transaction.payload,
        priorityFee: BigInt(0),
        networkId: this.networkId,
      });
      
      const summary = await generator.estimate();
      
      if (!summary || !summary.fees) {
        throw new Error("Estimation returned invalid result");
      }
      
      const result = {
        fees: Number(summary.fees) / 100000000,
        finalAmount: Number(summary.finalAmount) / 100000000,
        transactions: summary.transactions,
        utxos: summary.utxos
      };
      
      return result;
    } catch (error) {
      console.error("Error in estimateTransactionDetails:", error);
      throw error;
    }
  }

  public async estimateSendMessage(sendMessage: SendMessageArgs) {
    try {
      const minimumAmount = kaspaToSompi("0.1");

      if (!minimumAmount) {
        throw new Error("Minimum amount missing");
      }

      // Encrypt the message
      const encryptedMessage = encrypt_message(
        sendMessage.toAddress.toString(),
        sendMessage.message
      );

      const prefix = "ciph_msg:"
        .split("")
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("");

      const payload = prefix + encryptedMessage.to_hex();
      
      // Use a direct approach, minimizing string operations on addresses
      return this.estimateTransactionDetails({
        address: sendMessage.toAddress,
        amount: this.MESSAGE_AMOUNT,
        payload: payload,
      });
    } catch (error) {
      console.error("Error in estimateSendMessage:", error);
      throw error;
    }
  }

  public async sendMessage(sendMessage: SendMessageArgs) {
    this.ensurePasswordSet();

    const destinationAddress = this.ensureAddressPrefix(sendMessage.toAddress);
    
    const addressString = destinationAddress.toString();
    
    const encryptedMessage = encrypt_message(
      addressString,
      sendMessage.message
    );
    
    const encryptedHex = encryptedMessage.to_hex();

    const prefix = "ciph_msg:"
      .split("")
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
    
    const payload = prefix + encryptedHex;

    const txId = await this.createTransaction(
      {
        address: destinationAddress,
        amount: this.MESSAGE_AMOUNT,
        payload: payload,
      },
      sendMessage.password
    );
    
    return txId;
  }

  /**
   * Helper function to handle SEC1 format compatibility
   * for pre-encrypted messages
   */
  private adjustForSEC1Format(encryptedHex: string): string {
    // Check if the key starts with 02 or 03 (compressed SEC1 format)
    const keyStart = encryptedHex.substring(24, 26);
    if (keyStart !== '02' && keyStart !== '03') {
      return encryptedHex; // Not a SEC1 key, return unchanged
    }
    
    console.log("Detected SEC1 compressed key format in pre-encrypted message");
    
    // Extract components
    const nonce = encryptedHex.substring(0, 24);
    const ephemeralPublicKey = encryptedHex.substring(24, 24 + 66);
    const ciphertext = encryptedHex.substring(24 + 66);
    
    // Extract the X coordinate (without the 02/03 prefix)
    const publicKeyWithoutPrefix = ephemeralPublicKey.substring(2);
    
    // The public key should be exactly 32 bytes (64 hex chars)
    // If it's shorter, pad it with zeros at the end
    const paddedPublicKey = publicKeyWithoutPrefix.padEnd(64, '0');
    
    // Create new hex with padded public key
    const modifiedHex = nonce + paddedPublicKey + ciphertext;
    console.log("Adjusted hex for SEC1 format compatibility");
    
    return modifiedHex;
  }

  /**
   * Send a message using a pre-encrypted hex value from the visualizer
   * Use this to test sending a message with known-good encryption
   */
  public async sendPreEncryptedMessage(
    toAddress: Address, 
    preEncryptedHex: string, 
    password: string
  ) {
    // Ensure the destination address has the proper prefix
    const destinationAddress = this.ensureAddressPrefix(toAddress);
    console.log("Sending pre-encrypted message to:", destinationAddress.toString());
    console.log("Pre-encrypted message:", preEncryptedHex);
    
    // Ensure the pre-encrypted message is compatible with the Rust code
    const adjustedHex = this.adjustForSEC1Format(preEncryptedHex);
    
    const prefix = "ciph_msg:"
      .split("")
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
    
    // Use the provided pre-encrypted hex directly
    const payload = prefix + adjustedHex;
    console.log("Final transaction payload:", payload);

    return this.createTransaction(
      {
        address: destinationAddress,
        amount: this.MESSAGE_AMOUNT,
        payload: payload,
      },
      password
    );
  }

  public getMatureUtxos() {
    if (!this.isStarted) {
      throw new Error("Account service is not started");
    }

    return this.context.getMatureRange(0, this.context.matureLength);
  }

  /**
   * Helper method to ensure an address has the proper network prefix
   */
  private ensureAddressPrefix(address: Address): Address {
    const addressString = address.toString();
    
    // If address already has a prefix, return it unchanged
    if (addressString.includes(':')) {
      return address;
    }
    
    // Add appropriate prefix based on network
    let prefixedAddressString = addressString;
    if (this.networkId === 'testnet-10' || this.networkId === 'testnet-11') {
      prefixedAddressString = `kaspatest:${addressString}`;
    } else if (this.networkId === 'mainnet') {
      prefixedAddressString = `kaspa:${addressString}`;
    } else if (this.networkId === 'devnet') {
      prefixedAddressString = `kaspadev:${addressString}`;
    }
    
    console.log(`Added prefix to address: ${prefixedAddressString}`);
    return new Address(prefixedAddressString);
  }

  private _getGeneratorForTransaction(transaction: CreateTransactionArgs) {
    if (!this.isStarted) {
      throw new Error("Account service is not started");
    }

    // Ensure both addresses have the correct prefixes
    const destinationAddress = this.ensureAddressPrefix(transaction.address);
    const primaryAddress = this.ensureAddressPrefix(this.receiveAddress!);

    // Log both addresses for debugging
    console.log("Using destination address:", destinationAddress.toString());
    console.log("Using primary address for change:", primaryAddress.toString());

    return new Generator({
      changeAddress: primaryAddress,
      entries: this.context,
      outputs: [new PaymentOutput(destinationAddress, transaction.amount)],
      payload: transaction.payload,
      networkId: this.networkId,
      priorityFee: BigInt(0),
    });
  }

  private getOutputAddress(output: any): string | null {
    return output?.scriptPublicKey?.verboseData?.scriptPublicKeyAddress ||
           output?.verboseData?.scriptPublicKeyAddress ||
           output?.scriptPublicKeyAddress ||
           null;
  }

  private isMessageTransaction(tx: ITransaction): boolean {
    return tx?.payload?.startsWith(this.MESSAGE_PREFIX_HEX) ?? false;
  }

  private async processMessageTransaction(tx: any, blockHash: string, blockTime: number) {
    try {
      const txId = tx.verboseData?.transactionId;
      if (!txId || this.processedMessageIds.has(txId)) {
        return; // Skip if no txId or already processed
      }

      // Log raw transaction for debugging
      console.log("Processing message transaction:", {
        txId,
        hasInputs: !!tx.inputs?.length,
        numInputs: tx.inputs?.length,
        hasOutputs: !!tx.outputs?.length,
        numOutputs: tx.outputs?.length,
        payload: tx.payload?.substring(0, 50) + "..."
      });

      // Get sender and recipient from the transaction
      let sender = "Unknown";
      let recipient = "Unknown";
      
      if (tx.outputs && tx.outputs.length > 0) {
        // Log all outputs for debugging
        console.log("Transaction outputs:", tx.outputs.map((output: any) => ({
          value: typeof output.value === 'bigint' ? output.value.toString() : output.value,
          address: this.getOutputAddress(output),
          hasScriptPubKey: !!output.scriptPublicKey,
          hasVerboseData: !!output.scriptPublicKey?.verboseData
        })));
        
        // First find the message output (0.1 KAS)
        const messageOutput = tx.outputs.find((output: any) => {
          const value = typeof output.value === 'bigint' ? output.value : BigInt(output.value || 0);
          const isMessageOutput = value === this.MESSAGE_AMOUNT;
          console.log("Checking output for message:", {
            value: value.toString(),
            messageAmount: this.MESSAGE_AMOUNT.toString(),
            isMessageOutput,
            address: this.getOutputAddress(output)
          });
          return isMessageOutput;
        });

        // Get recipient from message output
        if (messageOutput) {
          const messageAddress = this.getOutputAddress(messageOutput);
          if (messageAddress) {
            recipient = messageAddress;
            console.log(`Found message recipient: ${recipient}`);
          } else {
            console.log("Could not find recipient address in message output:", messageOutput);
          }
        }

        // Find change output (any output that's not the message output)
        const changeOutput = tx.outputs.find((output: any) => {
          const value = typeof output.value === 'bigint' ? output.value : BigInt(output.value || 0);
          const address = this.getOutputAddress(output);
          const isChangeOutput = value !== this.MESSAGE_AMOUNT && address && address !== recipient;
          console.log("Checking output for change:", {
            value: value.toString(),
            address,
            recipientAddress: recipient,
            isChangeOutput
          });
          return isChangeOutput;
        });

        if (changeOutput) {
          const changeAddress = this.getOutputAddress(changeOutput);
          if (changeAddress) {
            sender = changeAddress;
            console.log(`Found sender from change output: ${sender}`);
          } else {
            console.log("Could not find sender address in change output:", changeOutput);
          }
        }

        // If we couldn't get sender from change output, try inputs as fallback
        if (sender === "Unknown" && tx.inputs && tx.inputs.length > 0) {
          console.log("Trying to find sender from inputs:", tx.inputs.map((input: any) => ({
            hasOutpoint: !!input.previousOutpoint,
            outpointAddress: input.previousOutpoint?.verboseData?.scriptPublicKeyAddress,
            verboseAddress: input.verboseData?.scriptPublicKeyAddress,
            previousOutpointAddress: input.previous_outpoint_address,
            rawInput: this.stringifyWithBigInt(input)
          })));

          const possibleSenderAddresses = tx.inputs
            .map((input: any) => {
              return [
                input.previousOutpoint?.verboseData?.scriptPublicKeyAddress,
                input.previousOutpoint?.scriptPublicKey?.verboseData?.scriptPublicKeyAddress,
                input.verboseData?.scriptPublicKeyAddress,
                input.scriptPublicKey?.verboseData?.scriptPublicKeyAddress,
                input.previous_outpoint_address,
                input.previousOutpoint?.address,
                input.address
              ].filter(Boolean);
            })
            .flat();

          if (possibleSenderAddresses.length > 0) {
            sender = possibleSenderAddresses[0];
            console.log(`Found sender from input data: ${sender}`);
          } else {
            console.log("No sender addresses found in inputs:", this.stringifyWithBigInt(tx.inputs));
          }
        }
      }

      // Log final results
      console.log("Message participants:", {
        sender,
        recipient,
        myAddress: this.receiveAddress?.toString(),
        txId,
        isIncoming: recipient === this.receiveAddress?.toString(),
        isOutgoing: sender === this.receiveAddress?.toString()
      });

      // Get amount from the message output
      let amount = 0;
      const messageOutput = tx.outputs?.find((o: any) => {
        const value = typeof o.value === 'bigint' ? o.value : BigInt(o.value || 0);
        return value === this.MESSAGE_AMOUNT;
      });
      if (messageOutput) {
        amount = Number(messageOutput.value) / 100000000;
      }

      // Check if this is a cipher message
      if (!tx.payload?.startsWith(this.MESSAGE_PREFIX_HEX)) {
        console.log(`Skipping transaction ${txId} - not a cipher message`);
        return;
      }

      // Ensure password is set before attempting decryption
      try {
        this.ensurePasswordSet();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.log(`Cannot decrypt message ${txId} - ${errorMessage}`);
        return;
      }

      // Strip the prefix and get the encrypted hex
      const encryptedHex = tx.payload.substring(this.MESSAGE_PREFIX_HEX.length);
      
      // Get private key for decryption
      const privateKeyGenerator = WalletStorage.getPrivateKeyGenerator(
        this.unlockedWallet,
        this.password!
      );
      
      let decryptedContent = "";
      let decryptionSuccess = false;

      // Try with receive key first
      try {
        const privateKey = privateKeyGenerator.receiveKey(0);
        const result = await CipherHelper.tryDecrypt(encryptedHex, privateKey.toString(), txId);
        decryptedContent = result;
        decryptionSuccess = true;
        console.log(`Successfully decrypted message with receive key`);
      } catch (error) {
        console.log(`Failed to decrypt with receive key:`, error);
      }

      // If not decrypted, try with change key
      if (!decryptionSuccess) {
        try {
          const privateKey = privateKeyGenerator.changeKey(0);
          const result = await CipherHelper.tryDecrypt(encryptedHex, privateKey.toString(), txId);
          decryptedContent = result;
          decryptionSuccess = true;
          console.log(`Successfully decrypted message with change key`);
        } catch (error) {
          console.log(`Failed to decrypt with change key:`, error);
        }
      }

      if (!decryptionSuccess) {
        console.log(`Could not decrypt message for transaction ${txId}`);
        return;
      }

      // Create message object that matches the UI's expected format
      const message: DecodedMessage = {
        transactionId: txId,
        senderAddress: sender,
        recipientAddress: recipient,
        content: decryptedContent,
        timestamp: blockTime,
        amount,
        payload: tx.payload
      };

      // Track this message
      this.processedMessageIds.add(txId);
      
      // Prevent unlimited growth of processed messages set
      if (this.processedMessageIds.size > this.MAX_PROCESSED_MESSAGES) {
        const idsArray = Array.from(this.processedMessageIds);
        this.processedMessageIds = new Set(idsArray.slice(-this.MAX_PROCESSED_MESSAGES));
      }

      // Store the message in local storage
      if (this.receiveAddress) {
        const messagingStore = (window as any).messagingStore;
        if (messagingStore) {
          const myAddress = this.receiveAddress.toString();
          
          // Determine the other party in the conversation
          const otherParty = sender === myAddress ? recipient : sender;
          
          // Store message under both addresses to ensure proper conversation grouping
          messagingStore.storeMessage(message, myAddress);
          messagingStore.storeMessage(message, otherParty);
          
          // Reload messages to update the UI
          messagingStore.loadMessages(myAddress);
          
          // Set the opened recipient to ensure the conversation stays focused
          if (messagingStore.openedRecipient === null) {
            messagingStore.setOpenedRecipient(otherParty);
          }
        }
      }

      // Emit the message event
      console.log(`Received new message in transaction ${txId} from ${sender} to ${recipient}`);
      this.emit("messageReceived", message);

    } catch (error) {
      console.error(`Error processing message transaction ${tx.verboseData?.transactionId}:`, error);
    }
  }

  private isTransactionForUs(tx: ITransaction): boolean {
    if (!this.receiveAddress) return false;
    const ourAddress = this.receiveAddress.toString();
    
    // Check if this is a message transaction
    const isMessageTx = this.isMessageTransaction(tx);
    if (!isMessageTx) return false;

    // For message transactions, check both outputs
    
    // Find message output and change output
    let messageOutput = null;
    let changeOutput = null;
    
    if (tx.outputs) {
      for (const output of tx.outputs) {
        const value = typeof output.value === 'bigint' ? output.value : BigInt(output.value || 0);
        const address = this.getOutputAddress(output);
        
        if (value === this.MESSAGE_AMOUNT) {
          messageOutput = output;
        } else {
          changeOutput = output;
        }
      }
    }

    // Get addresses from outputs
    const messageAddress = messageOutput ? this.getOutputAddress(messageOutput) : null;
    const changeAddress = changeOutput ? this.getOutputAddress(changeOutput) : null;

    // We're involved if we're either the recipient (message output)
    // or the sender (change output)
    const isInvolved = messageAddress === ourAddress || changeAddress === ourAddress;
    
    if (isInvolved) {
      console.log(`Transaction ${tx.verboseData?.transactionId} involves our address as ${messageAddress === ourAddress ? 'recipient' : 'sender'}`);
    }
    
    return isInvolved;
  }

  // Add this helper method to the class
  private stringifyWithBigInt(obj: any): string {
    return JSON.stringify(obj, (_, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
  }
}
