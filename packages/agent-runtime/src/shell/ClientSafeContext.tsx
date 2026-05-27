import { createContext, useContext, type ReactNode } from 'react';

export type AudienceMode = 'solo_builder' | 'firm_internal' | 'client_portal' | 'public';

export interface AudienceState {
  mode: AudienceMode;
  requiresLogin: boolean;
  clientSafeMode: boolean;
  allowAnonymousPreview: boolean;
}

export interface ClientSafeContextValue {
  audience: AudienceState;
  /**
   * Convenience: true when the app is in a client-facing posture
   * (mode=client_portal/public AND clientSafeMode=true). Consumers
   * should use this to hide developer-only UI bits.
   */
  isClientSafe: boolean;
}

const DEFAULT_AUDIENCE: AudienceState = {
  mode: 'solo_builder',
  requiresLogin: true,
  clientSafeMode: false,
  allowAnonymousPreview: false,
};

const ClientSafeContext = createContext<ClientSafeContextValue>({
  audience: DEFAULT_AUDIENCE,
  isClientSafe: false,
});

export interface ClientSafeProviderProps {
  audience: AudienceState | null | undefined;
  children: ReactNode;
}

export function ClientSafeProvider({ audience, children }: ClientSafeProviderProps) {
  const resolved = audience ?? DEFAULT_AUDIENCE;
  const isClientSafe =
    (resolved.mode === 'client_portal' || resolved.mode === 'public')
    && resolved.clientSafeMode;
  return (
    <ClientSafeContext.Provider value={{ audience: resolved, isClientSafe }}>
      {children}
    </ClientSafeContext.Provider>
  );
}

export function useClientSafe(): ClientSafeContextValue {
  return useContext(ClientSafeContext);
}
