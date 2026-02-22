"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Category = { id: string; name: string };
type SetRow = { id: string; title: string };

export default function Coach() {
  const router = useRouter();
  const [isCoach, setIsCoach] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [sets, setSets] = useState<SetRow[]>([]);
  const [setId, setSetId] = useState("");

  const [newSetTitle, setNewSetTitle] = useState("");

  const [categoryId, setCategoryId] = useState("");
  const [answer, setAnswer] = useState("");
  const [lines, setLines] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return router.push("/login");

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", u.user.id)
        .single();

      if (profile?.role !== "coach") return;

      setIsCoach(true);

      const { data: cats } = await supabase
        .from("categories")
        .select("id,name")
        .order("name");

      setCategories((cats ?? []) as any);
      if (cats?.[0]) setCategoryId(cats[0].id);

      const { data: s } = await supabase
        .from("sets")
        .select("id,title")
        .order("created_at", { ascending: false });

      setSets((s ?? []) as any);
      if (s?.[0]) setSetId(s[0].id);
    })();
  }, [router]);

  async function createSet() {
    setMsg(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const { error } = await supabase.from("sets").insert({
      title: newSetTitle.trim(),
      created_by: u.user.id,
    });

    if (error) return setMsg(error.message);

    setNewSetTitle("");
    setMsg("Set created.");
  }

  async function addTossup() {
    setMsg(null);
    if (!setId) return setMsg("Create or select a set.");

    const prompt_lines = lines
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (prompt_lines.length < 3) return setMsg("Enter at least 3 clue lines.");
    if (!answer.trim()) return setMsg("Enter an answer.");

    const { error } = await supabase.from("tossups").insert({
      set_id: setId,
      category_id: categoryId,
      answer: answer.trim(),
      prompt_lines,
    });

    if (error) return setMsg(error.message);

    setAnswer("");
    setLines("");
    setMsg("Tossup added.");
  }

  if (!isCoach) {
    return (
      <main style={{ padding: 40 }}>
        <h2>Coach Access Required</h2>
        <p>Set your role to "coach" in Supabase profiles table.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h2>Coach Dashboard</h2>

      <div style={{ marginTop: 20 }}>
        <h3>Create Set</h3>
        <input
          value={newSetTitle}
          onChange={(e) => setNewSetTitle(e.target.value)}
          placeholder="Week 1 Mixed Practice"
          style={{ width: "100%", padding: 10 }}
        />
        <button onClick={createSet} style={{ marginTop: 10 }}>
          Create
        </button>
      </div>

      <div style={{ marginTop: 40 }}>
        <h3>Add Tossup</h3>

        <select
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
          style={{ padding: 8 }}
        >
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <div style={{ marginTop: 12 }}>
          <label>Answer</label>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Clue lines (hard → easy, one per line)</label>
          <textarea
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            rows={6}
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <button onClick={addTossup} style={{ marginTop: 10 }}>
          Add Tossup
        </button>

        {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
      </div>
    </main>
  );
}
