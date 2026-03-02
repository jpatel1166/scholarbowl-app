"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit() {
    setMsg(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setLoading(false);

    if (error) setMsg(error.message);
    else router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 520, margin: "50px auto", padding: 16, fontFamily: "system-ui" }}>
      <h2>Log In</h2>

      <label>Email</label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "6px 0 12px" }}
      />

      <label>Password</label>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "6px 0 12px" }}
      />

      <button onClick={submit} disabled={loading} style={{ padding: "10px 14px" }}>
        {loading ? "Logging in..." : "Log in"}
      </button>

      <p style={{ marginTop: 14 }}>
        Need an account? <Link href="/signup">Student sign up</Link>
      </p>

      {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
    </main>
  );
}
