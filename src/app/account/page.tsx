"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/login");
      else setEmail(data.user.email ?? null);
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h2>Account</h2>
      <p>Signed in as: <b>{email}</b></p>

      <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
        <button onClick={logout} style={{ padding: "10px 14px" }}>Log out</button>
        <Link href="/play">Back to Tossups</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/play">Play</Link>
          <Link href="/account">Account</Link>
          <Link href="/coach">Coach</Link>
          <Link href="/stats">Stats</Link>
      </div>
    </main>
  );
}
