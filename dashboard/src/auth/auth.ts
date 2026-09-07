import { createContext, useContext } from 'react';
import { CurrentUser } from '../api';

// Lets the login page push the freshly authenticated user into the app shell
// without a refetch or full reload.
export type AuthApi = {
  onSignIn: (user: CurrentUser) => void;
};

export const AuthContext = createContext<AuthApi>({ onSignIn: () => {} });

export function useAuth(): AuthApi {
  return useContext(AuthContext);
}
