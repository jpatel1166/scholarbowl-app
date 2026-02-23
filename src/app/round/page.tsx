import { Suspense } from "react";
import RoundClient from "./RoundClient";

export default function RoundPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading round...</div>}>
      <RoundClient />
    </Suspense>
  );
}