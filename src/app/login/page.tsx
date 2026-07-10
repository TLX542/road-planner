"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Mot de passe incorrect.");
        setSubmitting(false);
        return;
      }

      const destination = searchParams.get("from") || "/";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Une erreur est survenue. Veuillez réessayer.");
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0b0b0c",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          width: "min(90vw, 320px)",
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Mot de passe"
          autoFocus
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            border: "1px solid #333",
            background: "#1a1a1c",
            color: "#f5f5f5",
            fontSize: "1rem",
          }}
        />
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            border: "none",
            background: "#f5f5f5",
            color: "#0b0b0c",
            fontSize: "1rem",
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "..." : "Entrer"}
        </button>
        {error ? <p style={{ color: "#ff6b6b", margin: 0, fontSize: "0.9rem" }}>{error}</p> : null}
      </form>
    </div>
  );
}

// The page is intentionally blank apart from the password field — no title,
// no branding — so nothing about the site is visible before authentication.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}