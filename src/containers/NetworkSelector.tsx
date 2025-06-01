import { FC, useMemo, useEffect, useRef } from "react";
import { NetworkType } from "../type/all";
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/react";

type NetworkSelectorProps = {
  onNetworkChange: (network: NetworkType) => void;
  selectedNetwork: NetworkType | null;
  isConnected?: boolean;
};

export const NetworkSelector: FC<NetworkSelectorProps> = ({
  onNetworkChange,
  selectedNetwork,
  isConnected,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Set default network to testnet-10 on component mount
  useEffect(() => {
    if (!selectedNetwork) {
      onNetworkChange("testnet-10");
    }
  }, [selectedNetwork, onNetworkChange]);

  // Add passive wheel event listeners
  useEffect(() => {
    const menuElement = menuRef.current;
    if (!menuElement) return;

    const options = { passive: true };
    const handler = (e: WheelEvent) => {
      // Handle wheel event if needed
    };

    menuElement.addEventListener('wheel', handler, options);
    return () => {
      menuElement.removeEventListener('wheel', handler);
    };
  }, []);

  const networkDisplay = useMemo(() => {
    switch (selectedNetwork) {
      case "mainnet":
        return "Mainnet";
      case "testnet-10":
        return "Testnet 10";
      case "testnet-11":
        return "Testnet 11";
      case null:
        return "Select Network";
      default:
        return "Unknown Network";
    }
  }, [selectedNetwork]);

  return (
    <div className="network-selector-container" ref={menuRef}>
      <Menu>
        <MenuButton className="network-badge">
          <span className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          {networkDisplay}
        </MenuButton>
        <MenuItems className="network-selector" anchor="bottom">
          <MenuItem>
            <div
              onClick={() => onNetworkChange("mainnet")}
              className={`${
                selectedNetwork === "mainnet" ? "active" : ""
              } network-option`}
            >
              Mainnet
            </div>
          </MenuItem>
          <MenuItem>
            <div
              onClick={() => onNetworkChange("testnet-10")}
              className={`${
                selectedNetwork === "testnet-10" ? "active" : ""
              } network-option`}
            >
              Testnet 10
            </div>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  );
};
