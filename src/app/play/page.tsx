"use client";
import { playSound } from "@/lib/sounds";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isAcceptable } from "@/lib/normalizeAnswer";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

function beepBuzz() {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "square";
    o.frequency.value = 880; // pitch
    g.gain.value = 0.05; // volume (keep low)

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 90);
  } catch {
    // If audio is blocked, silently do nothing.
  }
}

export default function Play() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  const [sets, setSets] = useState<SetRow[]>([]);
  const [setId, setSetId] = useState<string>("");

  const [tossup, setTossup] = useState<Tossup | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [buzzed, setBuzzed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<
  null | { correct: boolean; correctAnswer: string; attemptId?: string; points?: number; isPower?: boolean }
>(null);
const [scorePop, setScorePop] = useState<number | null>(null);
  const [startMs, setStartMs] = useState<number>(Date.now());

  // NEG LOCKOUT: if you neg, you can't buzz again on this tossup
  const [lockedOut, setLockedOut] = useState(false);

  // 5-second timer after last line revealed
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null); // null = not running

  // AUTO-REVEAL controls
  const [autoRevealOn, setAutoRevealOn] = useState(true);

  // QUESTION TIMER (new)
  const [questionTimerOn, setQuestionTimerOn] = useState(true);
  const QUESTION_SECONDS = 30;
  const [qSecondsLeft, setQSecondsLeft] = useState<number | null>(null); // null = not running

  // Category targeting
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all"); // "all" or category_id
  const [weakestCategoryIds, setWeakestCategoryIds] = useState<string[] | null>(null); // null = not computed yet
  const [useWeakestMode, setUseWeakestMode] = useState(false);

  // Answer input ref for autofocus (new)
  const answerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push("/login");
      else setUserId(data.user.id);
    });
  }, [router]);

  // Load sets
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

  // Load categories for dropdown
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

  // Helper: compute weakest categories for this user
  async function recomputeWeakest() {
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
  }

  useEffect(() => {
    if (!userId) return;
    recomputeWeakest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Countdown behavior: when secondsLeft hits 0, end tossup automatically
  useEffect(() => {
    if (secondsLeft === null) return;

    if (result || buzzed || lockedOut) {
      setSecondsLeft(null);
      return;
    }

    if (secondsLeft <= 0) {
      setSecondsLeft(null);
      setResult({ correct: false, correctAnswer: tossup?.answer ?? "" });
      return;
    }

    const id = setTimeout(() => {
      setSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);

    return () => clearTimeout(id);
  }, [secondsLeft, result, buzzed, lockedOut, tossup]);

  // Question timer tick (new)
  useEffect(() => {
    if (!questionTimerOn) {
      setQSecondsLeft(null);
      return;
    }
    if (qSecondsLeft === null) return;

    // Stop if tossup ended or student buzzed/locked out
    if (result || buzzed || lockedOut) return;

    if (qSecondsLeft <= 0) {
      setQSecondsLeft(0);
      setResult({ correct: false, correctAnswer: tossup?.answer ?? "" });
      // stop post-last-line countdown too
      setSecondsLeft(null);
      return;
    }

    const id = setTimeout(() => {
      setQSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);

    return () => clearTimeout(id);
  }, [questionTimerOn, qSecondsLeft, result, buzzed, lockedOut, tossup]);

  async function loadNext() {
    if (!setId) return;

    setResult(null);
    setAnswer("");
    setBuzzed(false);
    setLineIndex(0);
    setStartMs(Date.now());

    setLockedOut(false);
    setSecondsLeft(null);

    // Start question timer fresh (new)
    setQSecondsLeft(questionTimerOn ? QUESTION_SECONDS : null);

    let catIds: string[] | null = null;

    if (useWeakestMode && weakestCategoryIds && weakestCategoryIds.length > 0) {
      catIds = weakestCategoryIds;
    } else if (!useWeakestMode && categoryFilter !== "all") {
      catIds = [categoryFilter];
    }

    let q = supabase
      .from("tossups")
      .select("id,set_id,category_id,answer,acceptable_answers,prompt_lines,explanation,categories(name)")
      .eq("set_id", setId)
      .limit(200);

    if (catIds) q = q.in("category_id", catIds);

    const { data, error } = await q;

    if (error || !data || data.length === 0) {
      setTossup(null);
      return;
    }

    const pick = data[Math.floor(Math.random() * data.length)] as any as Tossup;
    setTossup(pick);
  }

  useEffect(() => {
    if (setId) loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  const visibleLines = useMemo(() => {
    if (!tossup) return [];
    return tossup.prompt_lines.slice(0, lineIndex + 1);
  }, [tossup, lineIndex]);

  const isLastLineVisible = !!tossup && lineIndex >= tossup.prompt_lines.length - 1;

  // AUTO-REVEAL effect
  useEffect(() => {
    if (!autoRevealOn) return;
    if (!tossup) return;
    if (result || buzzed || lockedOut) return;
    if (secondsLeft !== null) return;
    if (isLastLineVisible) return;

    const lastIndex = tossup.prompt_lines.length - 1;
    const delayMs = lineIndex < 2 ? 3000 : 3000;

    const id = setTimeout(() => {
      setLineIndex((prev) => {
        const next = Math.min(prev + 1, lastIndex);
        if (next === lastIndex) setSecondsLeft(5);
        return next;
      });
    }, delayMs);

    return () => clearTimeout(id);
  }, [autoRevealOn, tossup, lineIndex, result, buzzed, lockedOut, secondsLeft, isLastLineVisible]);

  function revealNextLine() {
    if (!tossup || buzzed || result) return;

    const lastIndex = tossup.prompt_lines.length - 1;

    if (lineIndex < lastIndex) {
      const next = lineIndex + 1;
      setLineIndex(next);
      if (next === lastIndex) setSecondsLeft(5);
    }
  }

  function buzz() {
  if (!tossup || result || lockedOut) return;

  playSound("/sounds/buzz.wav");   // 🔊 buzz sound
  setSecondsLeft(null);
  setBuzzed(true);
}

  // Auto-focus when buzzed (new)
  useEffect(() => {
    if (!buzzed) return;
    // wait 0ms so the input exists in the DOM
    const id = setTimeout(() => answerRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [buzzed]);

  async function submitAnswer() {
    if (!tossup || !userId) return;

    setSecondsLeft(null);

    const correct = isAcceptable(answer, tossup.answer, tossup.acceptable_answers ?? []);

    const n = tossup.prompt_lines.length;
    const powerCutoff = Math.floor(n / 2) - 1;
    const isPower = correct && lineIndex <= powerCutoff;

    const points = correct ? (isPower ? 15 : 10) : -5;
    

    if (!correct) {
  setLockedOut(true);
  setBuzzed(false);

  // NEW: after a neg, reveal the entire tossup immediately
  const lastIndex = (tossup.prompt_lines?.length ?? 1) - 1;
  setLineIndex(Math.max(0, lastIndex));

  // stop any countdown (optional, but usually what you want here)
  setSecondsLeft(null);
}

    const elapsed = (Date.now() - startMs) / 1000;

    const { data: inserted, error: insertError } = await supabase
  .from("attempts")
  .insert({
    user_id: userId,
    tossup_id: tossup.id,
    set_id: tossup.set_id,
    buzz_line_index: lineIndex,
    is_correct: correct,
    is_power: isPower,
    points,
    user_answer: answer,
    seconds_elapsed: elapsed,
  })
  .select("id")
  .single();

if (insertError) {
  alert("Error saving attempt: " + insertError.message);
  return;
}
// Reveal full clue after ANY buzz attempt (correct or neg)
const lastIndex = (tossup.prompt_lines?.length ?? 1) - 1;
setLineIndex(Math.max(0, lastIndex));

// Stop countdowns once answered
setSecondsLeft(null);
setQSecondsLeft(null); // if you’re using the question timer
setResult({
  correct,
  correctAnswer: tossup.answer,
  attemptId: inserted.id,
  points,
  isPower,
});
setScorePop(points);

// remove pop after animation
setTimeout(() => setScorePop(null), 900);
if (correct) {
  playSound("/sounds/correct.wav");   // 🔊 correct
} else {
  playSound("/sounds/neg.wav");       // 🔊 neg
}
    await recomputeWeakest();
  }

  const weakestButtonDisabled = !Array.isArray(weakestCategoryIds) || weakestCategoryIds.length === 0;

  // Keyboard shortcuts (new):
  // - Spacebar: buzz (unless typing)
  // - Enter: if result/lockedOut showing, go next (unless typing)
  useEffect(() => {
    function isTypingTarget(el: any) {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || el.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      const typing = isTypingTarget(e.target);

      // SPACEBAR = BUZZ
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        if (!buzzed && !result && !lockedOut) buzz();
        return;
      }

      // ENTER = NEXT tossup when result or locked out
      if (e.key === "Enter" && !typing) {
        if (result || lockedOut) {
          e.preventDefault();
          loadNext();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzed, result, lockedOut, tossup, setId]);

  return (
    <main style={{ maxWidth: 980, margin: "30px auto", padding: 16, fontFamily: "system-ui" }}>
        <style jsx>{`
@keyframes scorePopUp {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.8);
  }
  20% {
    opacity: 1;
    transform: translateY(0px) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translateY(-30px) scale(1);
  }
}
`}</style>
        <style jsx>{`
  @keyframes flash {
    0% {
      transform: scale(0.99);
      filter: brightness(0.9);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }
`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Tossup Practice</h2>
        <div style={{ display: "flex", gap: 14 }}>
          <Link href="/account">Account</Link>
          <Link href="/round">Round</Link>
          <Link href="/coach">Coach</Link>
          <Link href="/stats">Stats</Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "14px 0", flexWrap: "wrap" }}>
        <label>Question Set:</label>
        <select value={setId} onChange={(e) => setSetId(e.target.value)} style={{ padding: 8 }}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <button onClick={loadNext} style={{ padding: "8px 12px" }}>
          New Tossup
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <input type="checkbox" checked={autoRevealOn} onChange={(e) => setAutoRevealOn(e.target.checked)} />
          Auto-reveal lines
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={questionTimerOn}
            onChange={(e) => {
              const on = e.target.checked;
              setQuestionTimerOn(on);
              setQSecondsLeft(on ? QUESTION_SECONDS : null);
            }}
          />
          Question timer ({QUESTION_SECONDS}s)
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
          disabled={useWeakestMode}
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
          disabled={weakestButtonDisabled}
          style={{
            padding: "8px 12px",
            border: "1px solid #ccc",
            borderRadius: 6,
            opacity: weakestButtonDisabled ? 0.6 : 1,
            cursor: weakestButtonDisabled ? "not-allowed" : "pointer",
          }}
        >
          {useWeakestMode ? "Weakest 2 (ON)" : "My Weakest 2"}
        </button>

        {!Array.isArray(weakestCategoryIds) && (
          <span style={{ fontSize: 12, color: "#777" }}>Computing weakest categories…</span>
        )}

        {Array.isArray(weakestCategoryIds) && weakestCategoryIds.length === 0 && (
          <span style={{ fontSize: 12, color: "#777" }}>Need at least 5 attempts in a category first.</span>
        )}

        {useWeakestMode && Array.isArray(weakestCategoryIds) && weakestCategoryIds.length > 0 && (
          <span style={{ fontSize: 12, color: "#777" }}>Weakest mode active (2 categories)</span>
        )}
      </div>

      {!tossup ? (
        <p>No tossups found in this set (or none match your category filter yet).</p>
      ) : (
        <>
          <div style={{ position: "relative", border: "1px solid #ddd", borderRadius: 10, padding: 14, lineHeight: 1.5 }}>
            {scorePop !== null && (
  <div
    style={{
      position: "absolute",
      top: 10,
      right: 14,
      fontSize: 28,
      fontWeight: 700,
      color: scorePop > 0 ? "#16a34a" : "#dc2626",
      animation: "scorePopUp 0.9s ease-out",
      pointerEvents: "none",
    }}
  >
    {scorePop > 0 ? `+${scorePop}` : scorePop}
  </div>
)}
            {visibleLines.map((ln, i) => (
              <p key={i} style={{ margin: "8px 0" }}>
                {ln}
              </p>
            ))}
          </div>

          {/* Question timer display (new) */}
          {questionTimerOn && qSecondsLeft !== null && !result && !buzzed && !lockedOut && (
            <div style={{ marginTop: 10 }}>
              <b>Question time left:</b> {qSecondsLeft}s
            </div>
          )}

          {/* Post-last-line countdown display */}
          {secondsLeft !== null && !result && !buzzed && !lockedOut && (
            <div style={{ marginTop: 10 }}>
              <b>Time left after last line:</b> {secondsLeft}s
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={revealNextLine}
              disabled={buzzed || !!result || (isLastLineVisible && secondsLeft !== null)}
              style={{ padding: "10px 14px" }}
            >
              Next line
            </button>
            <button onClick={buzz} disabled={buzzed || !!result || lockedOut} style={{ padding: "10px 14px" }}>
              Buzz (Space)
            </button>
          </div>

          {lockedOut && (
            <p style={{ marginTop: 10 }}>
              You negged — locked out for this tossup. Click <b>Next Tossup</b> (or press Enter).
            </p>
          )}

          {buzzed && !result && (
            <div style={{ marginTop: 14 }}>
              <label>Your answer:</label>
              <input
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (answer.trim() !== "") submitAnswer();
                  }
                }}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                placeholder="Type your answer (Enter submits)"
              />
              <button onClick={submitAnswer} style={{ padding: "10px 14px", marginTop: 10 }}>
                Submit (Enter)
              </button>
            </div>
          )}

          {result && (
            <div
  style={{
    marginTop: 14,
    borderTop: "1px solid #eee",
    paddingTop: 12,
    borderRadius: 10,
    padding: 14,
    border: result.correct ? "2px solid #16a34a" : "2px solid #dc2626",
    background: result.correct ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)",
    animation: "flash 450ms ease-out",
  }}
>
              
              <p>
                Result: <b>{result.correct ? "Correct" : "Incorrect"}</b>
              </p>
              <p>
                Answer: <b>{result.correctAnswer}</b>
              </p>
              {result.attemptId && (
  <button
    onClick={async () => {
      const ok = confirm("Mark this attempt as CORRECT (override)?");
      if (!ok) return;

      const newIsCorrect = true;

      // recompute scoring for this same buzz moment
      const n = tossup?.prompt_lines.length ?? 0;
      const powerCutoff = Math.floor(n / 2) - 1;
      const newIsPower = newIsCorrect && lineIndex <= powerCutoff;
      const newPoints = newIsCorrect ? (newIsPower ? 15 : 10) : -5;

      const { error } = await supabase
        .from("attempts")
        .update({
          override_correct: true,
          override_by: userId,
          override_at: new Date().toISOString(),
          is_correct: true,
          is_power: newIsPower,
          points: newPoints,
        })
        .eq("id", result.attemptId);

      if (error) {
        alert("Override failed: " + error.message);
        return;
      }

      // update screen + refresh weakest/stats calculations
      setResult((r) => (r ? { ...r, correct: true, points: newPoints, isPower: newIsPower } : r));
      await recomputeWeakest();
      alert("Override saved.");
    }}
    style={{ padding: "10px 14px", marginTop: 10, border: "1px solid #ccc", borderRadius: 8 }}
  >
    Override to Correct
  </button>
)}
              {tossup.explanation && <p style={{ marginTop: 8 }}>{tossup.explanation}</p>}
              <button onClick={loadNext} style={{ padding: "10px 14px", marginTop: 10 }}>
                Next Tossup (Enter)
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}