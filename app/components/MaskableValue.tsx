"use client";

import type { ReactNode } from "react";
import { usePrivacy } from "./PrivacyContext";

// Digit-for-bullet: preserves the string's length (and every non-digit
// character — sign, thousands separators, decimal point) so a masked value
// occupies exactly the same width as the value it replaces. A fixed-length
// placeholder ("••••••" for every value) was the M1.5 regression this fixes:
// numeric table columns visibly shifted width when privacy was toggled.
function maskDigits(value: ReactNode): string {
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[0-9]/g, "•");
}

// Display-only: wraps a monetary or quantity value so the privacy toggle can
// hide it without touching the underlying data. Never wrap a percentage or
// allocation share here — those stay visible unconditionally (spec: they
// reveal nothing on their own).
export function MaskableValue({
  children,
  placeholder,
}: {
  children: ReactNode;
  placeholder?: string;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return <span aria-label="hidden">{placeholder ?? maskDigits(children)}</span>;
}
