"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function safeNext(v: string | null): string {
  if (!v) return "/tools/bgm-looper";
  try {
    const url = new URL(v, window.location.origin);
    if (url.origin !== window.location.origin) return "/tools/bgm-looper";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/tools/bgm-looper";
  }
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Invalid password");
      return;
    }
    router.push(safeNext(searchParams.get("next")));
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="border border-line px-2.5 py-1.5 text-fg"
      />
      <button type="submit" className="bg-accent px-2.5 py-1.5 font-semibold text-bg">
        Log in
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
