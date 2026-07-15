import { createContext, useContext } from "react";

// Per-request CSP nonce, provided by entry.server.tsx.
// Empty on the client — browsers hide nonce attributes after parsing,
// so hydration never sees a mismatch.
export const NonceContext = createContext<string | undefined>(undefined);

export function useNonce(): string | undefined {
  return useContext(NonceContext);
}
