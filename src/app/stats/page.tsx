"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Attempt = {
  user_id: string;
  is_correct: boolean;
  is_power: boolean;
  points: number;
  buzz_line_index: number;
   tossups?: {
    categories?: { name: string } | null;
  } | null;
};

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "student" | "coach";
};

function agg(attempts: Attempt[]) {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.is_correct).length;
  const powers = attempts.filter((a) => a.is_power).length;
  const negs = attempts.filter((a) => !a.is_correct).length;
  const points = attempts.reduce((s, a) => s + (a.points ?? 0), 0);

  const avgBuzz =
    total === 0
      ? null
      : Math.round(
          (((attempts.reduce((s, a) => s + (a.buzz_line_index ?? 0), 0) / total) + 1)) * 10
        ) / 10;

  const accuracy = total === 0 ? null : Math.round((correct / total) * 1000) / 10;
  const powerRate = correct === 0 ? null : Math.round((powers / correct) * 1000) / 10;

  return { total, correct, powers, negs, points, avgBuzz, accuracy, powerRate };
}

function aggByCategory(attempts: Attempt[]) {
  const map = new Map<string, Attempt[]>();

  for (const a of attempts) {
    const cat = a.tossups?.categories?.name || "Uncategorized";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(a);
  }

  const rows = Array.from(map.entries()).map(([category, arr]) => ({
    category,
    ...agg(arr),
  }));

  // Sort: most attempts first, then highest points
  rows.sort((a, b) => (b.total - a.total) || (b.points - a.points));
  return rows;
}


export default function Stats() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [myAttempts, setMyAttempts] = useState<Attempt[]>([]);
  const [allAttempts, setAllAttempts] = useState<Attempt[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return router.push("/login");

      const { data: prof } = await supabase
        .from("profiles")
        .select("id,email,display_name,role")
        .eq("id", u.user.id)
        .single();

      setMe(prof as any);

 const { data: mine } = await supabase
  .from("attempts")
  .select("user_id,is_correct,is_power,points,buzz_line_index,tossups(categories(name))")
  .eq("user_id", u.user.id);

setMyAttempts((mine ?? []) as any);


      if ((prof as any)?.role === "coach") {
const { data: all } = await supabase
  .from("attempts")
  .select("user_id,is_correct,is_power,points,buzz_line_index,tossups(categories(name))");


        setAllAttempts((all ?? []) as any);

        const { data: ps } = await supabase
          .from("profiles")
          .select("id,email,display_name,role")
          .order("created_at", { ascending: true });

        setProfiles((ps ?? []) as any);
      }
    })();
  }, [router]);

  const my = useMemo(() => agg(myAttempts), [myAttempts]);

  const leaderboard = useMemo(() => {
    if (!me || me.role !== "coach") return [];
    const byUser = new Map<string, Attempt[]>();
    for (const a of allAttempts) {
      if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
      byUser.get(a.user_id)!.push(a);
    }
    return profiles
      .filter((p) => p.role === "student")
      .map((p) => {
        const attempts = byUser.get(p.id) ?? [];
        return { p, ...agg(attempts) };
      })
      .sort((a, b) => b.points - a.points);
  }, [me, allAttempts, profiles]);
  const myByCategory = useMemo(() => aggByCategory(myAttempts), [myAttempts]);

const [selectedStudentId, setSelectedStudentId] = useState<string>("");

const coachSelectedAttempts = useMemo(() => {
  if (!me || me.role !== "coach") return [];
  return allAttempts.filter(a => a.user_id === selectedStudentId);
}, [me, allAttempts, selectedStudentId]);

const coachSelectedByCategory = useMemo(() => {
  if (!me || me.role !== "coach") return [];
  return aggByCategory(coachSelectedAttempts);
}, [me, coachSelectedAttempts]);

const teamByCategory = useMemo(() => {
  if (!me || me.role !== "coach") return [];
  return aggByCategory(allAttempts);
}, [me, allAttempts]);


  return (
    <main style={{ maxWidth: 980, margin: "30px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Stats</h2>
        <div style={{ display: "flex", gap: 14 }}>
               <Link href="/dashboard">Dashboard</Link>
          <Link href="/play">Play</Link>
          <Link href="/account">Account</Link>
          <Link href="/coach">Coach</Link>
          <Link href="/stats">Stats</Link>
        </div>
      </div>

      <section style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
        <h3 style={{ marginTop: 0 }}>Your Performance</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <div><b>Attempts</b><div>{my.total}</div></div>
          <div><b>Accuracy</b><div>{my.accuracy === null ? "—" : `${my.accuracy}%`}</div></div>
          <div><b>Total Points</b><div>{my.points}</div></div>
          <div><b>Powers</b><div>{my.powers}</div></div>
          <div><b>Power Rate</b><div>{my.powerRate === null ? "—" : `${my.powerRate}%`}</div></div>
          <div><b>Negs</b><div>{my.negs}</div></div>
          <div><b>Avg Buzz Line</b><div>{my.avgBuzz === null ? "—" : my.avgBuzz}</div></div>
        </div>
      </section>
      <section style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
  <h3 style={{ marginTop: 0 }}>Your Category Breakdown</h3>

  <table style={{ width: "100%", borderCollapse: "collapse" }}>
    <thead>
      <tr>
        <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Category</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Att</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Acc%</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Pts</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Powers</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Negs</th>
        <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Avg Buzz</th>
      </tr>
    </thead>
    <tbody>
      {myByCategory.map((r) => (
        <tr key={r.category}>
          <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.category}</td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.total}</td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            {r.accuracy === null ? "—" : `${r.accuracy}%`}
          </td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.points}</td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.powers}</td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.negs}</td>
          <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            {r.avgBuzz === null ? "—" : r.avgBuzz}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</section>


      {me?.role === "coach" && (
        <section style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Team Leaderboard</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Student</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Pts</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Att</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Acc%</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Powers</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Negs</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(({ p, total, points, accuracy, powers, negs }) => (
                <tr key={p.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                    {p.display_name || (p.email ? p.email.split("@")[0] : p.id)}
                  </td>
                  <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{points}</td>
                  <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{total}</td>
                  <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
                    {accuracy === null ? "—" : `${accuracy}%`}
                  </td>
                  <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{powers}</td>
                  <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{negs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 22 }}>Coach: Category Breakdown by Student</h3>

<div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
  <label>Select student:</label>
  <select value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
    {profiles
      .filter(p => p.role === "student")
      .map(p => (
        <option key={p.id} value={p.id}>
          {p.display_name || (p.email ? p.email.split("@")[0] : p.id)}
        </option>
      ))}
  </select>
</div>

<table style={{ width: "100%", borderCollapse: "collapse" }}>
  <thead>
    <tr>
      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Category</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Att</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Acc%</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Pts</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Powers</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Negs</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Avg Buzz</th>
    </tr>
  </thead>
  <tbody>
    {coachSelectedByCategory.map((r) => (
      <tr key={r.category}>
        <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.category}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.total}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
          {r.accuracy === null ? "—" : `${r.accuracy}%`}
        </td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.points}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.powers}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.negs}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
          {r.avgBuzz === null ? "—" : r.avgBuzz}
        </td>
      </tr>
    ))}
  </tbody>
</table>

<h3 style={{ marginTop: 22 }}>Coach: Team Category Summary</h3>

<table style={{ width: "100%", borderCollapse: "collapse" }}>
  <thead>
    <tr>
      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Category</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Att</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Acc%</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Pts</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Powers</th>
      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Negs</th>
    </tr>
  </thead>
  <tbody>
    {teamByCategory.map((r) => (
      <tr key={r.category}>
        <td style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.category}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.total}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>
          {r.accuracy === null ? "—" : `${r.accuracy}%`}
        </td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.points}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.powers}</td>
        <td style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #f1f5f9" }}>{r.negs}</td>
      </tr>
    ))}
  </tbody>
</table>

        </section>
      )}
    </main>
  );
}
