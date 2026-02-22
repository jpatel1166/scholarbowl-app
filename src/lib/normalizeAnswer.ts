export function normalizeAnswer(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAcceptable(user: string, answer: string, acceptable: string[] = []) {
  const u = normalizeAnswer(user);
  const a = normalizeAnswer(answer);
  if (!u) return false;
  if (u === a) return true;
  return acceptable.map(normalizeAnswer).includes(u);
}
