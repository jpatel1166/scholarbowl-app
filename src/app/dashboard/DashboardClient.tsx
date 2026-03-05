"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type TeamWeakRow = {
  category_id: string;
  category_name: string;
  students_with_badge: number;
  total_students: number;
};

type WeekActivityRow = {
  week_start: string; // e.g. "Mar 3"
  week_end: string;   // e.g. "Mar 9"
  team_rounds: number;
  team_questions: number;
};

type Row = {
  category_id: string;
  category_name: string;
  best_correct: number;
  total: number;
  last_played_at: string | null;
  question_count?: number; // NEW
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
type ScholarleToday = {
  puzzle_date: string; // date as string from RPC
  category_id: string;
  category_name: string;
  answer: string; // NOTE: client-visible
};

type ScholarleGuessRow = {
  puzzle_date: string;
  guess_num: number;
  guess: string;
};

function isFiveLetters(s: string) {
  return /^[A-Z]{5}$/.test(s);
}

// Wordle-style evaluation with duplicate-letter handling.
// Returns an array of 5: "g" (green), "y" (yellow), "b" (gray).
function evaluateWordle(guess: string, answer: string): ("g" | "y" | "b")[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();

  const res: ("g" | "y" | "b")[] = Array(5).fill("b");

  // Count letters in answer that are not already matched green
  const remaining: Record<string, number> = {};

  // First pass: greens
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      res[i] = "g";
    } else {
      remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
    }
  }

  // Second pass: yellows
  for (let i = 0; i < 5; i++) {
    if (res[i] === "g") continue;
    const ch = g[i];
    if ((remaining[ch] ?? 0) > 0) {
      res[i] = "y";
      remaining[ch] -= 1;
    }
  }

  return res;
}

function cellStyle(state: "g" | "y" | "b" | "e") {
  // "e" = empty
  const base: React.CSSProperties = {
    width: 44,
    height: 44,
    border: "2px solid #d3d6da",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 18,
    lineHeight: 1,
    userSelect: "none",
  };

  if (state === "e") return base;

  if (state === "g") {
    return { ...base, background: "#6aaa64", borderColor: "#6aaa64", color: "white" };
  }
  if (state === "y") {
    return { ...base, background: "#c9b458", borderColor: "#c9b458", color: "white" };
  }
  return { ...base, background: "#787c7e", borderColor: "#787c7e", color: "white" }; // b
}

function ScholarleCard() {
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<ScholarleToday | null>(null);
  const [guesses, setGuesses] = useState<ScholarleGuessRow[]>([]);
  const [guessInput, setGuessInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function loadScholarle() {
    setLoading(true);
    setMsg(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setMsg("Sign in to play Scholarle.");
      setLoading(false);
      return;
    }

    const { data: tData, error: tErr } = await supabase.rpc("scholarle_today");

if (tErr) {
  setMsg(tErr.message);
  setLoading(false);
  return;
}

if (!tData || !tData[0]) {
  setMsg("Scholarle is out of puzzles. Coach needs to add more 5-letter words to the bank.");
  setLoading(false);
  return;
}

    const { data: gData, error: gErr } = await supabase.rpc("scholarle_my_guesses");
    if (gErr) console.error("Scholarle guesses error:", gErr.message);

    setToday(tData[0] as ScholarleToday);
    setGuesses((gData ?? []) as ScholarleGuessRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadScholarle();
  }, []);

  const maxedOut = guesses.length >= 6;
  const solved = !!today && guesses.some((g) => g.guess.toUpperCase() === today.answer.toUpperCase());

  async function submitGuess() {
    if (!today) return;

    const raw = guessInput.trim().toUpperCase();
    if (!isFiveLetters(raw)) {
      setMsg("Enter a 5-letter word (A–Z).");
      return;
    }

    if (solved) {
      setMsg("Already solved today’s Scholarle.");
      return;
    }

    if (maxedOut) {
      setMsg("No guesses left today.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setMsg("Not signed in.");
      return;
    }

    const guessNum = guesses.length + 1;

    const { error: insErr } = await supabase.from("scholarle_attempts").insert({
      user_id: userData.user.id,
      puzzle_date: today.puzzle_date,
      guess_num: guessNum,
      guess: raw,
    });

    if (insErr) {
      setMsg(insErr.message);
      return;
    }

    setGuessInput("");
    setMsg(null);
    await loadScholarle();
  }

  // Build 6 rows of guesses (or empty)
  const grid = useMemo(() => {
    const rows: { letters: string[]; colors: ("g" | "y" | "b" | "e")[] }[] = [];
    for (let r = 0; r < 6; r++) {
      const g = guesses[r]?.guess?.toUpperCase() ?? "";
      const letters = g.padEnd(5, " ").slice(0, 5).split("");
      let colors: ("g" | "y" | "b" | "e")[] = Array(5).fill("e");
      if (today && isFiveLetters(g)) {
        colors = evaluateWordle(g, today.answer).map((c) => c) as any;
      }
      rows.push({
        letters,
        colors,
      });
    }
    return rows;
  }, [guesses, today]);

  return (
    <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14, background: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>🧩 Scholarle</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
            Category: <b>{today ? today.category_name : "…"}</b>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>
          {solved ? "Solved" : maxedOut ? "Out of guesses" : `${6 - guesses.length} guesses left`}
        </div>
      </div>

      {loading ? (
        <p style={{ marginTop: 12, color: "#555" }}>Loading…</p>
      ) : (
        <>
          <div style={{ marginTop: 12, display: "grid", gap: 6, justifyContent: "start" }}>
            {grid.map((row, rIdx) => (
              <div key={rIdx} style={{ display: "grid", gridTemplateColumns: "repeat(5, 44px)", gap: 6 }}>
                {row.letters.map((ch, cIdx) => (
                  <div key={cIdx} style={cellStyle(row.colors[cIdx])}>
                    {ch === " " ? "" : ch}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="GUESS"
              disabled={solved || maxedOut}
              style={{
                width: 120,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: "uppercase",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitGuess();
              }}
            />
            <button
              onClick={() => void submitGuess()}
              disabled={solved || maxedOut}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #ccc",
                background: "#111",
                color: "white",
                fontWeight: 800,
                opacity: solved || maxedOut ? 0.6 : 1,
                cursor: solved || maxedOut ? "not-allowed" : "pointer",
              }}
            >
              Submit
            </button>
            {msg && <span style={{ fontSize: 12, color: "#b00020", fontWeight: 700 }}>{msg}</span>}
          </div>

          {/* Optional: reveal answer after 6 guesses */}
          {today && maxedOut && !solved && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              Answer: <b>{today.answer}</b>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export default function DashboardClient() {
  const [teamWeak, setTeamWeak] = useState<TeamWeakRow[]>([]);
  const [weekActivity, setWeekActivity] = useState<WeekActivityRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<"category" | "best" | "last_played">("category");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [practicedToday, setPracticedToday] = useState(true);
  const [leaderboard, setLeaderboard] = useState<{ name: string; total_badges: number }[]>([]);

  // Practice streak (for THIS logged-in student)
  const [practiceStreak, setPracticeStreak] = useState<number>(0);

  // Streak leaders (TEAM)
  const [streakLeaders, setStreakLeaders] = useState<{ name: string; streak: number }[]>([]);

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

      // ----- Central-time "today" string -----
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

      // ----- Load this user's streak + last_practice_day -----
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("practice_streak,last_practice_day")
        .eq("id", userData.user.id)
        .single();

      if (pErr) console.error("Error loading practice streak:", pErr.message);

      const lastDay = profile?.last_practice_day ?? null;
      setPracticeStreak(profile?.practice_streak ?? 0);
      setPracticedToday(lastDay === today);

      // ----- Team weak categories (TOP 10 should be handled inside your SQL, but we just render what we get) -----
      const { data: weakData, error: weakErr } = await supabase.rpc("team_weak_categories");
      if (weakErr) console.error("Team weak categories error:", weakErr.message);
      if (!cancelled) setTeamWeak((weakData ?? []) as TeamWeakRow[]);

      // ----- Badge leaderboard (top 3) -----
      const { data: lbData, error: lbErr } = await supabase.rpc("badge_leaderboard");
      if (lbErr) console.error("Leaderboard error:", lbErr.message);
      if (!cancelled) setLeaderboard(lbData ?? []);

      // ----- This week’s activity (team rounds + team questions + week range) -----
      const { data: waData, error: waErr } = await supabase.rpc("team_week_activity");
      if (waErr) console.error("Week activity error:", waErr.message);
      const waRow = Array.isArray(waData) && waData.length ? (waData[0] as WeekActivityRow) : null;
      if (!cancelled) setWeekActivity(waRow);

      // ----- Current streak leader(s) (ties supported) -----
      // 1) find top streak value
      const { data: topRow, error: topErr } = await supabase
        .from("profiles")
        .select("practice_streak")
        .eq("role", "student")
        .order("practice_streak", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (topErr) console.error("Top streak lookup error:", topErr.message);

      const topStreak = topRow?.practice_streak ?? 0;

      if (topStreak > 0) {
        // 2) fetch all students with that streak (ties)
        const { data: leaderRows, error: leadersErr } = await supabase
          .from("profiles")
          .select("display_name,practice_streak")
          .eq("role", "student")
          .eq("practice_streak", topStreak)
          .order("display_name", { ascending: true });

        if (leadersErr) console.error("Streak leaders error:", leadersErr.message);

        const leaders =
          (leaderRows ?? []).map((r: any) => ({
            name: r.display_name ?? "Student",
            streak: r.practice_streak ?? topStreak,
          })) ?? [];

        if (!cancelled) setStreakLeaders(leaders);
      } else {
        if (!cancelled) setStreakLeaders([]);
      }

      // ----- Category table data -----
      const { data, error: qErr } = await supabase.rpc("dashboard_best_by_category");
      
      if (qErr) {
        if (!cancelled) {
          setError(qErr.message);
          setLoading(false);
        }
        return;
      }
const { data: countData, error: countErr } = await supabase.rpc("category_question_counts");
if (countErr) console.error("Question count error:", countErr.message);

const countMap = new Map<string, number>(
  (countData ?? []).map((r: any) => [r.category_id, r.question_count])
);

const merged = ((data ?? []) as Row[]).map((r) => ({
  ...r,
  question_count: countMap.get(r.category_id) ?? 0,
}));

if (!cancelled) {
  setRows(merged);
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

  const weekLabel =
  weekActivity
    ? `${new Date(weekActivity.week_start).toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${new Date(weekActivity.week_end).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
    : "";

  const streakLeaderLabel =
    streakLeaders.length > 0
      ? `${streakLeaders.map((s) => s.name).join(", ")} (${streakLeaders[0].streak} day${streakLeaders[0].streak === 1 ? "" : "s"})`
      : "—";

  return (
    <main style={{ maxWidth: 980, margin: "30px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
      </div>

      {/* Top row: streak pill + warning */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <div
          style={{
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

        {!practicedToday && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              background: "#fff3cd",
              border: "1px solid #ffeeba",
              fontWeight: 800,
              color: "#856404",
            }}
          >
            ⚠️ Complete a full round today to keep your streak alive.
          </div>
        )}
      </div>

      {/* Two-column widgets row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          alignItems: "start",
          marginTop: 14,
        }}
      >
        {/* LEFT COLUMN: badge leaders + this week's activity */}
        <div>
          {leaderboard.length > 0 && (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>🏆 Top Badge Earners</div>

              {leaderboard.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: 600,
                    padding: "4px 0",
                  }}
                >
                  <span>
                    {i === 0 && "1️⃣ "}
                    {i === 1 && "2️⃣ "}
                    {i === 2 && "3️⃣ "}
                    {p.name}
                  </span>
                  <span>{p.total_badges}</span>
                </div>
              ))}
            </div>
          )}

          {/* NEW WIDGET: This Week's Activity */}
          <div
            style={{
              marginTop: 14,
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              📅 This Week&apos;s Activity{" "}
              {weekLabel ? <span style={{ fontWeight: 700, color: "#666", fontSize: 12 }}>({weekLabel})</span> : null}
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#555", fontWeight: 700 }}>Team rounds completed</span>
                <span style={{ fontWeight: 800 }}>{weekActivity?.team_rounds ?? "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#555", fontWeight: 700 }}>Team questions answered</span>
                <span style={{ fontWeight: 800 }}>{weekActivity?.team_questions ?? "—"}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#555", fontWeight: 700 }}>Current streak leader(s)</span>
                <span style={{ fontWeight: 800 }}>{streakLeaderLabel}</span>
              </div>

              <div style={{ fontSize: 12, color: "#777", marginTop: 6 }}>
  Streak leaders can span beyond the current week.
</div>

<ScholarleCard />

</div>
</div>
        </div>

        {/* RIGHT COLUMN: team weak categories */}
        {teamWeak.length > 0 && (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>🧠 Team Weak Categories</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
              Based on how many students have earned at least one badge in each category. This will become more accurate the more the team plays.
            </div>

            {teamWeak.map((c) => (
              <div
                key={c.category_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderTop: "1px solid #eee",
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{c.category_name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    Coverage: {c.students_with_badge}/{c.total_students}
                  </div>

                  {/* little progress bar for readability */}
                  <div style={{ marginTop: 6, height: 6, background: "#e9e9e9", borderRadius: 999, overflow: "hidden", maxWidth: 260 }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${c.total_students ? Math.round((c.students_with_badge / c.total_students) * 100) : 0}%`,
                        background: "#111",
                      }}
                    />
                  </div>
                </div>

                <Link
                  href={`/round?category_id=${encodeURIComponent(c.category_id)}&n=20`}
                  style={{
                    display: "inline-block",
                    padding: "8px 14px",
                    borderRadius: 12,
                    textDecoration: "none",
                    fontWeight: 900,
                    color: "white",
                    background: "#111",
                    minWidth: 64,
                    textAlign: "center",
                  }}
                >
                  Go
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Badge counts */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
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

      {/* Practice weakest CTA */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        {weakest ? (
          <Link
            href={`/round?category_id=${encodeURIComponent(weakest.category_id)}&n=20`}
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 12,
              background: "#111",
              color: "white",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            Practice Weakest: {weakest.category_name} ({weakest.best_correct}/20)
          </Link>
        ) : (
          <Link
            href={`/round?n=20`}
            style={{
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 12,
              background: "#111",
              color: "white",
              textDecoration: "none",
              fontWeight: 900,
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
              fontWeight: 800,
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
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 800, color: "#555", cursor: "pointer" }}
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
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 800, color: "#555", cursor: "pointer" }}
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
              style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, fontWeight: 800, color: "#555", cursor: "pointer" }}
            >
              Last Played {sortArrow(sortKey === "last_played", sortDir)}
            </button>

            <div style={{ textAlign: "right" }}>Go</div>
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
                <div style={{ fontWeight: 700 }}>
  {r.category_name}{" "}
  <span style={{ fontWeight: 600, color: "#666" }}>
    ({r.question_count ?? 0})
  </span>
</div>

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

              <div style={{ color: "#333", fontWeight: 800 }}>
                {r.best_correct}/{r.total}
              </div>

              <div style={{ fontSize: 12, color: "#555" }}>{formatLastPlayed(r.last_played_at)}</div>

              <div style={{ textAlign: "right" }}>
                <Link
                  href={`/round?category_id=${encodeURIComponent(r.category_id)}&n=20`}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    borderRadius: 12,
                    border: "1px solid #ccc",
                    textDecoration: "none",
                    fontWeight: 900,
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