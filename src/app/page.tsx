"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main style={{ 
      maxWidth: 900, 
      margin: "60px auto", 
      padding: 20, 
      fontFamily: "system-ui",
      textAlign: "center"
    }}>
      <h1 style={{ fontSize: 40, marginBottom: 20 }}>
        Scholar Bowl Practice
      </h1>

      <p style={{ fontSize: 18, marginBottom: 40 }}>
        High school NAQT-style tossup training.
      </p>

      <div style={{ display: "flex", gap: 20, justifyContent: "center" }}>
        <Link href="/login">
          <button style={{ padding: "12px 20px", fontSize: 16 }}>
            Log In
          </button>
        </Link>

        <Link href="/signup">
          <button style={{ padding: "12px 20px", fontSize: 16 }}>
            Student Sign Up
          </button>
        </Link>
      </div>
    </main>
  );
}
