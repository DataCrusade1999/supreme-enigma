import { connection } from "next/server";

// Next.js puts the proxy's CSP nonce on its scripts only when it renders a page
// per request (#385). Without this, the tool pages that read no request data are
// prerendered, their scripts carry no nonce, and the browser blocks them.
export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
