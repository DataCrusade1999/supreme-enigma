"use client";
import { useEffect, useRef } from "react";
import QRCode from "qrcode";

// Shows a freshly made peer config once. The parent drops the config from its
// state in onClose, so closing this is the last place the private key lives.
export function NewPeerConfig({ config, filename, onClose }: { config: string; filename: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (canvasRef.current) void QRCode.toCanvas(canvasRef.current, config, { errorCorrectionLevel: "M" }).catch(() => {});
  }, [config]);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([config], { type: "text/plain" }));
    if (linkRef.current) linkRef.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [config]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-5">
      <div role="dialog" aria-modal="true" aria-label="New device config" className="flex max-h-full w-full max-w-md flex-col items-center gap-4 overflow-auto border-2 border-rule-heavy bg-bg p-6">
        <canvas ref={canvasRef} aria-label="WireGuard config QR code" className="max-w-full" />
        <p className="text-sm text-muted">
          This is the only time this key is shown. Scan it on the phone, or download the .conf and import it in the WireGuard app, then delete the file.
        </p>
        <div className="flex w-full gap-4 text-sm">
          <a ref={linkRef} download={filename} className="text-accent hover:text-fg">Download .conf</a>
          <button type="button" onClick={onClose} className="ml-auto text-muted hover:text-fg">Close</button>
        </div>
      </div>
    </div>
  );
}
