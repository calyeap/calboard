"use client";

import type { ReactNode } from "react";
import { usePrivacy } from "./PrivacyContext";

// Display-only: wraps a monetary or quantity value so the privacy toggle can
// hide it without touching the underlying data. Never wrap a percentage or
// allocation share here — those stay visible unconditionally (spec: they
// reveal nothing on their own).
export function MaskableValue({
  children,
  placeholder = "••••••",
}: {
  children: ReactNode;
  placeholder?: string;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <>{children}</>;
  return <span aria-label="hidden">{placeholder}</span>;
}
