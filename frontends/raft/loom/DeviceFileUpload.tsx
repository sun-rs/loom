import { uiActionProps } from "./ui-action-props.ts";
import { useRef } from "react";
import { Button } from "raft-ui";
import { Upload } from "lucide-react";
export default function DeviceFileUpload({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: FileList) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="relative isolate mr-auto inline-flex max-sm:mr-0 max-sm:w-full">
      <Button
        {...uiActionProps.secondary}
        className="max-sm:w-full"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} />
        上传此设备文件
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        aria-label="上传此设备文件"
        data-testid="loom-native-file-input"
        disabled={disabled}
        className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
        onChange={(e) => {
          if (!disabled && e.currentTarget.files?.length)
            onFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
    </span>
  );
}
