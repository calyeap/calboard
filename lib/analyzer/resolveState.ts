import type { AnalyzerIdentity } from "./identity";

// The shape useActionState carries between Screen 1 renders.
//
// Held outside app/actions/analyzer.ts because a "use server" module may only
// export async functions — an exported constant there fails the build with
// "A 'use server' file can only export async functions, found object".

export interface ResolveState {
  identity: AnalyzerIdentity | null;
  /** Echoed back so UNAVAILABLE can keep the entry in the field. */
  entered: string;
}

export const EMPTY_RESOLVE_STATE: ResolveState = { identity: null, entered: "" };
