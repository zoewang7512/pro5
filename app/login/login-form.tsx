"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setSubmitting(false);

    if (signInError) {
      setError("帳號或密碼錯誤，請再試一次。");
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  return (
    <main style={{ padding: 32, maxWidth: 360 }}>
      <h1>設計師登入</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          密碼
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: "#b91c1c" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
