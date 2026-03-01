"use client";
import { playSound } from "@/lib/sounds";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isAcceptable } from "@/lib/normalizeAnswer";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type BadgeTier = "bronze" | "silver" | "gold" | "perfect";

function tiersEarned(score: number, total: number): BadgeTier[] {
  // Using raw thresholds for rounds out of 20 (still works if total differs)
  const earned: BadgeTier[] = [];
  if (score >= 10) earned.push("bronze");
  if (score >= 15) earned.push("silver");
  if (score >= 18) earned.push("gold");
  if (score >= 20) earned.push("perfect");
  return earned;
}

function tierLabel(t: BadgeTier) {
  if (t === "bronze") return "Bronze";
  if (t === "silver") return "Silver";
  if (t === "gold") return "Gold";
  return "Perfect";
}

type Tossup = {
  id: string;
  set_id: string;
  category_id?: string | null;
  categories?: { name: string } | null;

  answer: string;
  acceptable_answers: string[] | null;
  prompt_lines: string[];
  explanation: string | null;
};

type SetRow = { id: string; title: string };

const ROUND_LENGTH_DEFAULT = 10;

// Fisher–Yates shuffle (uniform)
function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function RoundPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Auth
  const [userId, setUserId] = useState<string | null>(null);

  // Sets
  const [sets, setSets] = useState<SetRow[]>([]);
  const [setId, setSetId] = useState<string>("");

  // Category targeting
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [weakestCategoryIds, setWeakestCategoryIds] = useState<string[] | null>(null);
  const [useWeakestMode, setUseWeakestMode] = useState(false);

  // Tossup state
  const [tossup, setTossup] = useState<Tossup | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [buzzed, setBuzzed] = useState(false);
  const [answer, setAnswer] = useState("");
  const answerInputRef = useRef<HTMLInputElement | null>(null);
  const [lastAttemptId, setLastAttemptId] = useState<string | null>(null);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [result, setResult] = useState<null | {
    correct: boolean;
    correctAnswer: string;
    points: number;
    isPower: boolean;
  }>(null);

  // Timing / mechanics
  const [startMs, setStartMs] = useState<number>(Date.now());
  const [lockedOut, setLockedOut] = useState(false);

  // Auto-reveal + 5-second countdown after last line
  const [autoRevealOn, setAutoRevealOn] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Round mode state
  const [roundActive, setRoundActive] = useState(false);
  const [roundLen, setRoundLen] = useState(ROUND_LENGTH_DEFAULT);
  const [qNum, setQNum] = useState(1);

  // Effective round total (prevents repeats + ends early if not enough tossups)
  const [roundTotal, setRoundTotal] = useState(ROUND_LENGTH_DEFAULT);

  // Round stats
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [powerCount, setPowerCount] = useState(0);
  const [negCount, setNegCount] = useState(0);
  const correctCountRef = useRef(0);

  // Badge message shown in summary
  const [badgeMessage, setBadgeMessage] = useState<string | null>(null);

  // Round queue (IDs shuffled once per round; no repeats)
  const roundQueueRef = useRef<string[]>([]);

  // ---------- Auth ----------
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/login");
      else setUserId(data.user.id);
    });
  }, [router]);

  // Preselect category from dashboard link: /round?category_id=...&n=20
  useEffect(() => {
    if (roundActive) return;

    const cid = searchParams.get("category_id");
    if (cid) {
      setUseWeakestMode(false);
      setCategoryFilter(cid);
    }

    const n = searchParams.get("n");
    if (n) {
      const parsed = Number(n);
      if (parsed === 10 || parsed === 15 || parsed === 20) setRoundLen(parsed);
    }
  }, [searchParams, roundActive]);

  // ---------- Load sets ----------
  useEffect(() => {
    supabase
      .from("sets")
      .select("id,title")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const s = (data ?? []) as any as SetRow[];
        setSets(s);
        if (s[0]) setSetId(s[0].id);
      });
  }, []);

  // ---------- Load categories ----------
  useEffect(() => {
    supabase
      .from("categories")
      .select("id,name")
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("Error loading categories:", error.message);
          return;
        }
        setCategories((data ?? []) as any);
      });
  }, []);

  // ---------- Weakest category computation ----------
  const recomputeWeakest = useCallback(async () => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("attempts")
      .select("is_correct,tossups(categories(id,name))")
      .eq("user_id", userId);

    if (error) {
      console.error("Error recomputing weakest categories:", error.message);
      setWeakestCategoryIds([]);
      return;
    }

    const byCat = new Map<string, { total: number; correct: number }>();

    for (const a of (data ?? []) as any[]) {
      const cat = a.tossups?.categories;
      if (!cat?.id) continue;

      if (!byCat.has(cat.id)) byCat.set(cat.id, { total: 0, correct: 0 });
      const r = byCat.get(cat.id)!;

      r.total += 1;
      if (a.is_correct) r.correct += 1;
    }

    const ranked = Array.from(byCat.entries())
      .map(([id, r]) => ({ id, acc: r.correct / r.total, total: r.total }))
      .filter((r) => r.total >= 5)
      .sort((a, b) => a.acc - b.acc);

    setWeakestCategoryIds(ranked.slice(0, 2).map((r) => r.id));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    recomputeWeakest();
  }, [userId, recomputeWeakest]);

  // ---------- Helper: get current eligible category IDs ----------
  const getEligibleCategoryIds = useCallback((): string[] | null => {
    let catIds: string[] | null = null;

    if (useWeakestMode && weakestCategoryIds && weakestCategoryIds.length > 0) {
      catIds = weakestCategoryIds;
    } else if (!useWeakestMode && categoryFilter !== "all") {
      catIds = [categoryFilter];
    }

    return catIds;
  }, [useWeakestMode, weakestCategoryIds, categoryFilter]);

  // ---------- Helper: fetch ALL eligible tossup IDs (paged) ----------
  const fetchAllEligibleIds = useCallback(async (): Promise<string[]> => {
    if (!setId) return [];

    const catIds = getEligibleCategoryIds();

    const pageSize = 1000;
    let from = 0;
    let all: { id: string }[] = [];

    while (true) {
      let q = supabase.from("tossups").select("id").eq("set_id", setId).range(from, from + pageSize - 1);
      if (catIds) q = q.in("category_id", catIds);

      const { data, error } = await q;

      if (error) {
        console.error("Error loading tossup ids:", error.message);
        return [];
      }

      const rows = (data ?? []) as { id: string }[];
      all = all.concat(rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return all.map((r) => r.id);
  }, [setId, getEligibleCategoryIds]);

  // ---------- Load next tossup from the round queue ----------
  const loadNextTossup = useCallback(async () => {
    const nextId = roundQueueRef.current.shift();

    if (!nextId) {
      setRoundActive(false);
      setTossup(null);
      return;
    }

    setResult(null);
    setLastAttemptId(null);
    setAnswer("");
    setBuzzed(false);
    setLockedOut(false);
    setLineIndex(0);
    setStartMs(Date.now());
    setSecondsLeft(null);

    const { data, error } = await supabase
      .from("tossups")
      .select("id,set_id,category_id,answer,acceptable_answers,prompt_lines,explanation,categories(name)")
      .eq("id", nextId)
      .single();

    if (error || !data) {
      console.error("Error loading tossup:", error?.message);
      setTossup(null);
      return;
    }

    setTossup(data as any as Tossup);
  }, []);

  // ---------- Visible lines ----------
  const visibleLines = useMemo(() => {
    if (!tossup) return [];
    return tossup.prompt_lines.slice(0, lineIndex + 1);
  }, [tossup, lineIndex]);

  const isLastLineVisible = !!tossup && lineIndex >= tossup.prompt_lines.length - 1;

  // ---------- Auto reveal ----------
  useEffect(() => {
    if (!autoRevealOn) return;
    if (!tossup) return;
    if (!roundActive) return;
    if (result || buzzed || lockedOut) return;
    if (secondsLeft !== null) return;
    if (isLastLineVisible) return;

    const lastIndex = tossup.prompt_lines.length - 1;
    const delayMs = 4000;

    const id = setTimeout(() => {
      setLineIndex((prev) => {
        const next = Math.min(prev + 1, lastIndex);
        if (next === lastIndex) setSecondsLeft(5);
        return next;
      });
    }, delayMs);

    return () => clearTimeout(id);
  }, [autoRevealOn, tossup, lineIndex, result, buzzed, lockedOut, secondsLeft, isLastLineVisible, roundActive]);

  // ---------- Countdown after last line ----------
  useEffect(() => {
    if (secondsLeft === null) return;
    if (!roundActive) {
      setSecondsLeft(null);
      return;
    }
    if (result || buzzed || lockedOut) {
      setSecondsLeft(null);
      return;
    }
    if (secondsLeft <= 0) {
      setSecondsLeft(null);
      setResult({
        correct: false,
        correctAnswer: tossup?.answer ?? "",
        points: 0,
        isPower: false,
      });
      return;
    }

    const id = setTimeout(() => {
      setSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);

    return () => clearTimeout(id);
  }, [secondsLeft, result, buzzed, lockedOut, tossup, roundActive]);

  // ---------- Controls ----------
  const buzz = useCallback(() => {
    if (!tossup || result || lockedOut) return;
    setSecondsLeft(null);
    setBuzzed(true);
    setTimeout(() => answerInputRef.current?.focus(), 0);
  }, [tossup, result, lockedOut]);

  const revealNextLine = useCallback(() => {
    if (!tossup || buzzed || result || lockedOut) return;

    const lastIndex = tossup.prompt_lines.length - 1;
    if (lineIndex < lastIndex) {
      const next = lineIndex + 1;
      setLineIndex(next);
      if (next === lastIndex) setSecondsLeft(5);
    }
  }, [tossup, buzzed, result, lockedOut, lineIndex]);

  const submitAnswer = useCallback(async () => {
    if (!tossup || !userId) return;

    setSecondsLeft(null);

    const raw = answerInputRef.current?.value ?? answer;
    const trimmed = raw.trim();

    const correct = isAcceptable(trimmed, tossup.answer, tossup.acceptable_answers ?? []);

    const n = tossup.prompt_lines.length;
    const powerCutoff = Math.floor(n / 2) - 1;
    const isPower = correct && lineIndex <= powerCutoff;

    const points = correct ? (isPower ? 15 : 10) : -5;

    if (!correct) {
      setLockedOut(true);
      setBuzzed(false);
      setLineIndex(tossup.prompt_lines.length - 1);
    }

    setResult({ correct, correctAnswer: tossup.answer, points, isPower });

    const elapsed = (Date.now() - startMs) / 1000;

    const { data: inserted, error: insErr } = await supabase
      .from("attempts")
      .insert({
        user_id: userId,
        tossup_id: tossup.id,
        set_id: tossup.set_id,
        buzz_line_index: lineIndex,
        is_correct: correct,
        is_power: isPower,
        points,
        user_answer: trimmed,
        seconds_elapsed: elapsed,
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("Error inserting attempt:", insErr.message);
    } else {
      setLastAttemptId(inserted?.id ?? null);
    }

    await recomputeWeakest();

    setScore((s) => s + points);
    if (correct) {
  correctCountRef.current += 1;
  setCorrectCount((c) => c + 1);
}
    if (isPower) setPowerCount((p) => p + 1);
    if (!correct) setNegCount((n2) => n2 + 1);
  }, [tossup, userId, answer, lineIndex, startMs, recomputeWeakest]);

  // ---------- Save round summary + unlock badges ----------
  const finalizeRound = useCallback(async (completed: boolean) => {
    if (!userId) return;
const finalCorrect = correctCountRef.current;
    // Always compute message (so you get feedback even if they played "All" by accident)
    const total = roundTotal || 20;
    const earned = tiersEarned(finalCorrect, total);
    const bestTier = earned.length ? earned[earned.length - 1] : null;

    const isSingleCategory = !useWeakestMode && categoryFilter !== "all";

    if (!isSingleCategory) {
      // Helpful message so it doesn't feel "broken"
      if (bestTier) {
        setBadgeMessage(
          `You would have earned ${tierLabel(bestTier)} (${finalCorrect}/${total}). Badges unlock only in single-category rounds (use Dashboard → Go).`
        );
      } else {
        setBadgeMessage(`Badges unlock only in single-category rounds (use Dashboard → Go).`);
      }
      return;
    }

    // Save round summary (single-category only)
    const { error } = await supabase.from("practice_rounds").insert({
      user_id: userId,
      category_id: categoryFilter,
      correct: finalCorrect,
      total: roundTotal,
    });

    // ---- Practice streak (only when a full 20-question round is completed) ----
    if (completed && roundTotal === 20) {
      const { error: streakErr } = await supabase.rpc("update_practice_streak");
      if (streakErr) console.error("Streak update error:", streakErr.message);
    }

    if (error) console.error("Error saving round:", error.message);

    // Save badge unlocks (single-category only)
    // This assumes you created a table badge_unlocks with a UNIQUE constraint on (user_id, category_id, tier)
    try {
      if (earned.length > 0) {
        const rowsToUpsert = earned.map((tier) => ({
          user_id: userId,
          category_id: categoryFilter,
          tier,
          score: finalCorrect,
          total,
        }));

        // Upsert with ignoreDuplicates prevents errors if they already earned it before.
        const { error: badgeErr } = await supabase
          .from("badge_unlocks")
          .upsert(rowsToUpsert, { onConflict: "user_id,category_id,tier", ignoreDuplicates: true });

        if (badgeErr) console.log("Badge unlock upsert:", badgeErr.message);

        const top = earned[earned.length - 1];
        setBadgeMessage(`Badge earned: ${tierLabel(top)} (${finalCorrect}/${total})`);
      } else {
        setBadgeMessage(null);
      }
    } catch (e) {
      console.error("Badge error", e);
    }
  }, [userId, useWeakestMode, categoryFilter, roundTotal]);

  // ---------- NEXT IN ROUND (saves when round ends) ----------
  const nextInRound = useCallback(() => {
    setResult(null);
    setBuzzed(false);
    setLockedOut(false);
    setSecondsLeft(null);
    setAnswer("");
    setLineIndex(0);

   if (qNum >= roundTotal) {
  setTimeout(() => {
    void finalizeRound(true);
  }, 0);

  setRoundActive(false);
  setTossup(null);
  return;
}

    setQNum(qNum + 1);
    loadNextTossup();
  }, [qNum, roundTotal, loadNextTossup, finalizeRound]);

  const startRound = useCallback(async () => {
    setBadgeMessage(null); // clear previous unlock text
    setRoundActive(true);
    setQNum(1);
    setScore(0);
    setCorrectCount(0);
    setPowerCount(0);
    setNegCount(0);
    correctCountRef.current = 0;

    const ids = await fetchAllEligibleIds();
    if (!ids || ids.length === 0) {
      setRoundActive(false);
      setTossup(null);
      setRoundTotal(roundLen);
      return;
    }

    shuffleInPlace(ids);

    const total = Math.min(roundLen, ids.length);
    setRoundTotal(total);

    roundQueueRef.current = ids.slice(0, total);

    loadNextTossup();
  }, [fetchAllEligibleIds, roundLen, loadNextTossup]);

  // ---------- End round early (also saves) ----------
  const endRound = useCallback(() => {
    void finalizeRound(false);

    setRoundActive(false);
    setTossup(null);
    setResult(null);
    setBuzzed(false);
    setLockedOut(false);
    setSecondsLeft(null);
    setAnswer("");
    setLineIndex(0);
    roundQueueRef.current = [];
  }, [finalizeRound]);

  // ---------- Keyboard controls ----------
  useEffect(() => {
    function isTypingInInput() {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return true;
      if ((el as any).isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!roundActive) return;

      if (e.code === "Space") {
        if (isTypingInInput()) return;

        e.preventDefault();
        if (tossup && !result && !buzzed && !lockedOut) {
          buzz();
        }
        return;
      }

      if (e.key === "Enter") {
        if (result) {
          e.preventDefault();
          nextInRound();
          return;
        }

        if (buzzed && !lockedOut && !result) {
          e.preventDefault();
          submitAnswer();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [roundActive, tossup, result, buzzed, lockedOut, buzz, submitAnswer, nextInRound]);

  const weakestButtonDisabled = !Array.isArray(weakestCategoryIds) || weakestCategoryIds.length === 0;

  const roundFinished =
    !roundActive &&
    qNum >= roundTotal &&
    (score !== 0 || correctCount !== 0 || negCount !== 0 || powerCount !== 0);

  const pointsText = (pts: number) => (pts > 0 ? `+${pts}` : `${pts}`);

  const overrideCorrect = useCallback(async () => {
    if (!lastAttemptId) return;
    if (overrideSaving) return;
    if (!result || result.correct) return;

    setOverrideSaving(true);

    const { error } = await supabase
      .from("attempts")
      .update({
        is_override: true,
        is_correct: true,
        points: 10,
        is_power: false,
      })
      .eq("id", lastAttemptId);

    if (error) {
      console.error("Override error:", error.message);
      setOverrideSaving(false);
      return;
    }

    const delta = 10 - result.points;
    setScore((s) => s + delta);

    if (result.points < 0) {
      setNegCount((n) => Math.max(0, n - 1));
    }

    setCorrectCount((c) => c + 1);
    correctCountRef.current += 1;

    setResult({ ...result, correct: true, points: 10, isPower: false });

    await recomputeWeakest();
    setOverrideSaving(false);
  }, [lastAttemptId, recomputeWeakest, result, overrideSaving]);

  return (
    <main style={{ maxWidth: 980, margin: "30px auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Round Mode</h2>
        <div style={{ display: "flex", gap: 14 }}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/play">Play</Link>
          <Link href="/account">Account</Link>
          <Link href="/coach">Coach</Link>
          <Link href="/stats">Stats</Link>
        </div>
      </div>

      {/* Setup controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "14px 0", flexWrap: "wrap" }}>
        <label>Question Set:</label>
        <select value={setId} onChange={(e) => setSetId(e.target.value)} style={{ padding: 8 }} disabled={roundActive}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <label style={{ marginLeft: 6 }}>Round length:</label>
        <select value={roundLen} onChange={(e) => setRoundLen(Number(e.target.value))} style={{ padding: 8 }} disabled={roundActive}>
          <option value={10}>10</option>
          <option value={15}>15</option>
          <option value={20}>20</option>
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <input type="checkbox" checked={autoRevealOn} onChange={(e) => setAutoRevealOn(e.target.checked)} />
          Auto-reveal lines
        </label>
      </div>

      {/* Category controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label>Category:</label>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setUseWeakestMode(false);
            setCategoryFilter(e.target.value);
          }}
          style={{ padding: 8 }}
          disabled={useWeakestMode || roundActive}
        >
          <option value="all">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            if (weakestButtonDisabled) return;
            setUseWeakestMode((prev) => !prev);
            setCategoryFilter("all");
          }}
          disabled={weakestButtonDisabled || roundActive}
          style={{
            padding: "8px 12px",
            border: "1px solid #ccc",
            borderRadius: 6,
            opacity: weakestButtonDisabled || roundActive ? 0.6 : 1,
            cursor: weakestButtonDisabled || roundActive ? "not-allowed" : "pointer",
          }}
        >
          {useWeakestMode ? "Weakest 2 (ON)" : "My Weakest 2"}
        </button>

        {!Array.isArray(weakestCategoryIds) && <span style={{ fontSize: 12, color: "#777" }}>Computing weakest…</span>}
        {Array.isArray(weakestCategoryIds) && weakestCategoryIds.length === 0 && (
          <span style={{ fontSize: 12, color: "#777" }}>Need at least 5 attempts in a category first.</span>
        )}
      </div>

      {/* Round header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
        <div>
          <b>Status:</b>{" "}
          {roundActive ? (
            <span>
              Question {qNum} / {roundTotal}
            </span>
          ) : roundFinished ? (
            <span>Round finished</span>
          ) : (
            <span>Not started</span>
          )}
        </div>
        <div>
          <b>Score:</b> {score}{" "}
          <span style={{ color: "#777", marginLeft: 10 }}>
            (Powers {powerCount} | Correct {correctCount} | Negs {negCount})
          </span>
        </div>
      </div>

      {/* Start / end buttons */}
      {!roundActive && !roundFinished && (
        <button onClick={startRound} style={{ padding: "10px 14px", border: "1px solid #ccc", borderRadius: 8 }}>
          Start Round
        </button>
      )}

      {roundActive && (
        <button onClick={endRound} style={{ padding: "10px 14px", border: "1px solid #ccc", borderRadius: 8 }}>
          End Round Early
        </button>
      )}

      {/* Summary */}
      {roundFinished && (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Round Summary</h3>
          <p style={{ margin: "8px 0" }}>
            <b>Final score:</b> {score}
          </p>
          <p style={{ margin: "8px 0" }}>
            <b>Powers:</b> {powerCount}
          </p>
          <p style={{ margin: "8px 0" }}>
            <b>Correct:</b> {correctCount}
          </p>
          <p style={{ margin: "8px 0" }}>
            <b>Negs:</b> {negCount}
          </p>

          {badgeMessage && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 14px",
                background: "#111",
                color: "white",
                borderRadius: 8,
                fontWeight: 600,
              }}
            >
              🏅 {badgeMessage}
            </div>
          )}

          <button onClick={startRound} style={{ padding: "10px 14px", marginRight: 10 }}>
            Start Another Round
          </button>
          <button
            onClick={() => {
              setQNum(1);
              setScore(0);
              setCorrectCount(0);
              setPowerCount(0);
              setNegCount(0);
              setBadgeMessage(null);
            }}
            style={{ padding: "10px 14px" }}
          >
            Reset Summary
          </button>
        </div>
      )}

      {/* Tossup UI */}
      {roundActive && !tossup ? <p style={{ marginTop: 14 }}>No tossups found for this set/filter.</p> : null}

      {roundActive && tossup && (
        <>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14, lineHeight: 1.5, marginTop: 14 }}>
            {visibleLines.map((ln, i) => (
              <p key={i} style={{ margin: "8px 0" }}>
                {ln}
              </p>
            ))}
          </div>

          {secondsLeft !== null && !result && !buzzed && !lockedOut && (
            <div style={{ marginTop: 10 }}>
              <b>Time left after last line:</b> {secondsLeft}s
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={revealNextLine}
              disabled={buzzed || !!result || lockedOut || (isLastLineVisible && secondsLeft !== null)}
              style={{ padding: "10px 14px" }}
            >
              Next line
            </button>
            <button onClick={buzz} disabled={buzzed || !!result || lockedOut} style={{ padding: "10px 14px" }}>
              Buzz (Space)
            </button>
          </div>

          {lockedOut && <p style={{ marginTop: 10 }}>You negged — locked out for this tossup. Continue to the next question.</p>}

          {buzzed && !result && (
            <div style={{ marginTop: 14 }}>
              <label>Your answer:</label>
              <input
                ref={answerInputRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                placeholder="Type your answer"
              />
              <button onClick={submitAnswer} style={{ padding: "10px 14px", marginTop: 10 }}>
                Submit (Enter)
              </button>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 12 }}>
              <p style={{ margin: "8px 0" }}>
                Result: <b>{result.correct ? "Correct" : "Incorrect"}</b>{" "}
                <span style={{ color: "#777" }}>({pointsText(result.points)} points)</span>
                {result.isPower ? (
                  <span style={{ marginLeft: 10 }}>
                    <b>POWER</b>
                  </span>
                ) : null}
              </p>
              <p style={{ margin: "8px 0" }}>
                Answer: <b>{result.correctAnswer}</b>
              </p>
              {tossup.explanation && <p style={{ marginTop: 8 }}>{tossup.explanation}</p>}
              {!result.correct && result.points < 0 && lastAttemptId && (
                <button onClick={overrideCorrect} disabled={overrideSaving} style={{ padding: "10px 14px", marginTop: 10, marginRight: 10 }}>
                  {overrideSaving ? "Overriding..." : "Override to Correct (+10)"}
                </button>
              )}
              <button onClick={nextInRound} style={{ padding: "10px 14px", marginTop: 10 }}>
                Next Question ({qNum}/{roundTotal})
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}