import { FC, useState, useRef } from "react";
import { PhotoIcon, UserIcon, TrashIcon } from "@heroicons/react/24/solid";
import { AvatarHash } from "./icons/AvatarHash";
import { useWalletStore } from "../store/wallet.store";
import { useMessagingStore } from "../store/messaging.store";
import clsx from "clsx";

interface ProfileSettingsProps {
  address: string;
  nickname?: string;
  avatar?: string;
  avatarType?: "generated" | "uploaded" | "letter";
  onSave: (data: {
    nickname?: string;
    avatar?: string;
    avatarType?: "generated" | "uploaded" | "letter";
  }) => void;
}

export const ProfileSettings: FC<ProfileSettingsProps> = ({
  address,
  nickname,
  avatar,
  avatarType = "generated",
  onSave,
}) => {
  const [tempNickname, setTempNickname] = useState(nickname || "");
  const [tempAvatar, setTempAvatar] = useState(avatar);
  const [tempAvatarType, setTempAvatarType] = useState(avatarType);
  const [previewImage, setPreviewImage] = useState(avatar);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("Please select an image smaller than 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewImage(result);
      setTempAvatar(result);
      setTempAvatarType("uploaded");
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    onSave({
      nickname: tempNickname.trim() || undefined,
      avatar: tempAvatar,
      avatarType: tempAvatarType,
    });
  };

  const handleRemoveAvatar = () => {
    setPreviewImage(undefined);
    setTempAvatar(undefined);
    setTempAvatarType("generated");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUseGenerated = () => {
    setPreviewImage(undefined);
    setTempAvatar(undefined);
    setTempAvatarType("generated");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUseLetter = () => {
    setPreviewImage(undefined);
    setTempAvatar(undefined);
    setTempAvatarType("letter");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--secondary-bg)] p-6">
      <h3 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
        Profile Settings
      </h3>

      {/* Avatar Section */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
          Profile Picture
        </label>

        {/* Avatar Preview */}
        <div className="mb-4 flex items-center gap-4">
          <div className="relative">
            {previewImage ? (
              <img
                src={previewImage}
                alt="Avatar preview"
                className="h-16 w-16 rounded-full border-2 border-[var(--border-color)] object-cover"
              />
            ) : tempAvatarType === "letter" && tempNickname ? (
              <div className="bg-kas-primary flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white">
                {tempNickname.charAt(0).toUpperCase()}
              </div>
            ) : (
              <AvatarHash address={address} size={64} />
            )}
          </div>

          <div className="flex-1">
            <p className="mb-2 text-sm text-[var(--text-secondary)]">
              {tempAvatarType === "uploaded"
                ? "Custom image"
                : tempAvatarType === "letter"
                  ? "Letter avatar"
                  : "Generated avatar"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-kas-primary hover:bg-kas-secondary flex items-center gap-1 rounded px-3 py-1 text-sm text-white transition-colors"
              >
                <PhotoIcon className="h-4 w-4" />
                Upload
              </button>

              <button
                onClick={handleUseGenerated}
                className={clsx(
                  "flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors",
                  tempAvatarType === "generated"
                    ? "bg-kas-secondary text-white"
                    : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                )}
              >
                Generated
              </button>

              {tempNickname && (
                <button
                  onClick={handleUseLetter}
                  className={clsx(
                    "flex items-center gap-1 rounded px-3 py-1 text-sm transition-colors",
                    tempAvatarType === "letter"
                      ? "bg-kas-secondary text-white"
                      : "bg-gray-600 text-gray-300 hover:bg-gray-500"
                  )}
                >
                  <UserIcon className="h-4 w-4" />
                  Letter
                </button>
              )}

              {tempAvatar && (
                <button
                  onClick={handleRemoveAvatar}
                  className="flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-sm text-white transition-colors hover:bg-red-700"
                >
                  <TrashIcon className="h-4 w-4" />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Nickname Section */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
          Display Name
        </label>
        <input
          type="text"
          value={tempNickname}
          onChange={(e) => setTempNickname(e.target.value)}
          placeholder="Enter your display name"
          className="w-full rounded border border-[var(--border-color)] bg-[var(--primary-bg)] px-3 py-2 text-[var(--text-primary)] placeholder-[var(--text-secondary)]"
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-2">
        <button
          onClick={handleSave}
          className="bg-kas-primary hover:bg-kas-secondary rounded px-4 py-2 text-white transition-colors"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
};
