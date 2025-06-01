import { NetworkType } from "../type/all";

export type NodeConfig = {
  url: string;
  description: string;
  useWebSocket?: boolean;
};

export const networkNodes: Record<NetworkType, NodeConfig[]> = {
  "mainnet": [
    { url: "wss://kaspa.aspectron.org/kaspa/mainnet/wrpc/borsh", description: "Aspectron (WebSocket)" },
    { url: "https://kaspa.aspectron.org/kaspa/mainnet/wrpc/borsh", description: "Aspectron" },
    { url: "wss://fermion.kaspa.green/kaspa/mainnet/wrpc/borsh", description: "Kaspa Green (WebSocket)" },
  ],
  "testnet-10": [
    { url: "wss://fermion-10.kaspa.green/kaspa/testnet-10/wrpc/borsh", description: "Kaspa Green (WebSocket)", useWebSocket: true },
    { url: "wss://kaspa-testnet.aspectron.org/kaspa/testnet-10/wrpc/borsh", description: "Aspectron (WebSocket)", useWebSocket: true },
    { url: "wss://api.kaspatestnet.org/ws", description: "KaspaTestnet.org (WebSocket)", useWebSocket: true },
  ],
  "testnet-11": [
    { url: "wss://fermion-11.kaspa.green/kaspa/testnet-11/wrpc/borsh", description: "Kaspa Green (WebSocket)" },
  ],
  "devnet": [
    { url: "wss://fermion-dev.kaspa.green/kaspa/devnet/wrpc/borsh", description: "Kaspa Green (WebSocket)" },
  ],
};

export const getNodesForNetwork = (network: NetworkType): NodeConfig[] => {
  return networkNodes[network] || [];
}; 