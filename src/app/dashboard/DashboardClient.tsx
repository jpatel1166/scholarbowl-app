"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  category_id: string;
  category_name: string;
  best_correct: number;
  total: number;
  last_played_at: string | null;
};
function badgeFromBest(best: number) {
  if (best >= 20) return { label: "Perfect", emoji: "💎" };
  if (best >= 18) return { label: "Gold", emoji: "🥇" };
  if (best >= 15) return { label: "Silver", emoji: "🥈" };
  if (best >= 10) return { label: "Bronze", emoji: "🥉" };
  return { label: "Unranked", emoji: "⬜" };
}

function nextTarget(best: number) {
  if (best >= 20) return null;
  if (best < 10) return { label: "Bronze", need: 10 - best };
  if (best < 15) return { label: "Silver", need: 15 - best };
  if (best < 18) return { label: "Gold", need: 18 - best };
  return { label: "Perfect", need: 20 - best };
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(best: number, total: number) {
  if (!total) return 0;
  return clamp(Math.round((best / total) * 100), 0, 100);
}
function formatLastPlayed(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { timeZone: "America/Chicago" });
}
function sortArrow(active: boolean, dir: "asc" | "desc") {
  if (!active) return "↕";
  return dir === "asc" ? "↑" : "↓";
}
export default function DashboardClient() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"category" | "best" | "last_played">("category");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // NEW: practice streak
  const [practiceStreak, setPracticeStreak] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        if (!cancelled) {
          setError("Not signed in.");
          setLoading(false);
        }
        return;
      }

      // NEW: load streak from profiles
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("practice_streak")
        .eq("id", userData.user.id)
        .single();

      if (!cancelled) {
        if (pErr) console.error("Error loading practice streak:", pErr.message);
        setPracticeStreak(profile?.practice_streak ?? 0);
      }

      const { data, error: qErr } = await supabase.rpc("dashboard_best_by_category");
      if (qErr) {
        if (!cancelled) {
          setError(qErr.message);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const weakest = useMemo(() => {
    if (!rows.length) return null;
    let w = rows[0];
    for (const r of rows) {
      if (r.best_correct < w.best_correct) w = r;
    }
    return w;
  }, [rows]);

  const badgeCounts = useMemo(() => {
    const counts = { Perfect: 0, Gold: 0, Silver: 0, Bronze: 0, Unranked: 0 };
    for (const r of rows) {
      const b = badgeFromBest(r.best_correct).label as keyof typeof counts;
      counts[b] += 1;
    }
    return counts;
  }, [rows]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];

    function cmp(a: Row, b: Row) {
      if (sortKey === "category") {
        const av = (a.category_name ?? "").toLowerCase();
        const bv = (b.category_name ?? "").toLowerCase();
        return av.localeCompare(bv);
      }

      if (sortKey === "best") {
        return (a.best_correct ?? 0) - (b.best_correct ?? 0);
      }

      const at = a.last_played_at ? new Date(a.last_played_at).getTime() : 0;
      const bt = b.last_played_at ? new Date(b.last_played_at).getTime() : 0;
      return at - bt;
    }

    copy.sort((a, b) => {
      const base = cmp(a, b);
      return sortDir === "asc" ? base : -base;
    });

    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <main style={{ maxWidth: 820, margin: "30px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <div style={{ marginTop: 6, color: "#555" }}>Best score per category (out of 20)</div>

          {/* NEW: practice streak */}
          <div
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid #ddd",
              background: "#fafafa",
              fontWeight: 800,
              color: "#111",
            }}
          >
            <span style={{ fontSize: 18 }}>🔥</span>
            <span>{practiceStreak} Day Practice Streak</span>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "#fafafa" }}>
            💎 Perfect: <b>{badgeCounts.Perfect}</b>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "#fafafa" }}>
            🥇 Gold: <b>{badgeCounts.Gold}</b>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "#fafafa" }}>
            🥈 Silver: <b>{badgeCounts.Silver}</b>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "#fafafa" }}>
            🥉 Bronze: <b>{badgeCounts.Bronze}</b>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 999, padding: "6px 10px", background: "#fafafa" }}>
            ⬜ Unranked: <b>{badgeCounts.Unranked}</b>
          </div>
        </div>

        {weakest ? (
          <Link
            href={`/round?category_id=${encodeURIComponent(weakest.category_id)}&n=20`}
            style={{
              display: "inline-block",
              padding: "10px 12px",
              borderRadius: 10,
              background: "#111",
              color: "white",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Practice Weakest: {weakest.category_name} ({weakest.best_correct}/20)
          </Link>
        ) : (
          <Link
            href={`/round?n=20`}
            style={{
              display: "inline-block",
              padding: "10px 12px",
              borderRadius: 10,
              background: "#111",
              color: "white",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Start a Round
          </Link>
        )}
      </div>

      {loading && <p style={{ marginTop: 14, color: "#555" }}>Loading…</p>}

      {error && (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 12, background: "#fafafa" }}>
          <b>Error:</b> {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ marginTop: 18, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 160px 170px 90px",
              padding: "10px 12px",
              background: "#f4f4f4",
              fontSize: 12,
              fontWeight: 700,
              color: "#555",
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (sortKey === "category") setSortDir(sortDir === "asc" ? "desc" : "asc");
                else {
                  setSortKey("category");
                  setSortDir("asc");
                }
              }}
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 700, color: "#555", cursor: "pointer" }}
            >
              Category {sortArrow(sortKey === "category", sortDir)}
            </button>

            <button
              type="button"
              onClick={() => {
                if (sortKey === "best") setSortDir(sortDir === "asc" ? "desc" : "asc");
                else {
                  setSortKey("best");
                  setSortDir("desc");
                }
              }}
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 700, color: "#555", cursor: "pointer" }}
            >
              Best {sortArrow(sortKey === "best", sortDir)}
            </button>

            <button
              type="button"
              onClick={() => {
                if (sortKey === "last_played") setSortDir(sortDir === "asc" ? "desc" : "asc");
                else {
                  setSortKey("last_played");
                  setSortDir("desc");
                }
              }}
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 700, color: "#555", cursor: "pointer" }}
            >
              Last Played {sortArrow(sortKey === "last_played", sortDir)}
            </button>

            <div style={{ textAlign: "right" }}>Practice</div>
          </div>

          {sortedRows.map((r) => (
            <div
              key={r.category_id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 160px 170px 90px",
                padding: "10px 12px",
                borderTop: "1px solid #eee",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>{r.category_name}</div>

                <div style={{ marginTop: 6, height: 8, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct(r.best_correct, r.total)}%`,
                      background: "#111",
                    }}
                  />
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                  {badgeFromBest(r.best_correct).emoji} {badgeFromBest(r.best_correct).label}
                  {nextTarget(r.best_correct) ? ` • ${nextTarget(r.best_correct)!.need} more for ${nextTarget(r.best_correct)!.label}` : " • Maxed"}
                  {" • "}
                  {pct(r.best_correct, r.total)}%
                </div>
              </div>

              <div style={{ color: "#333", fontWeight: 700 }}>
                {r.best_correct}/{r.total}
              </div>
              <div style={{ fontSize: 12, color: "#555" }}>
                {formatLastPlayed(r.last_played_at)}
              </div>
              <div style={{ textAlign: "right" }}>
                <Link
                  href={`/round?category_id=${encodeURIComponent(r.category_id)}&n=20`}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid #ccc",
                    textDecoration: "none",
                    fontWeight: 700,
                    color: "#111",
                    background: "white",
                  }}
                >
                  Go
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}