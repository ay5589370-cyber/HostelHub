import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { getProfile } from "../services/profiles";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState("");
  const generation = useRef(0);
  const activeUserId = useRef(null);
  const sync = useCallback(async (next) => {
    const ticket = ++generation.current;
    const sameUser = Boolean(
      next?.user.id && activeUserId.current === next.user.id,
    );
    activeUserId.current = next?.user.id || null;
    setSession(next);
    // Token refresh / tab focus must not unmount a multi-step admission draft.
    if (!sameUser) setProfile(null);
    setError("");
    if (!sameUser) setLoading(true);
    try {
      const data = next ? await getProfile(next.user.id) : null;
      if (ticket === generation.current) setProfile(data);
    } catch {
      if (ticket === generation.current) {
        setProfile(null);
        setError(
          "We could not load your account. Check your connection and database setup.",
        );
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const requestGeneration = generation;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Keep Supabase calls outside the auth callback to avoid auth-lock deadlocks.
      setTimeout(() => {
        if (alive) void sync(next);
      }, 0);
    });
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (!alive) return;
      if (err) {
        setError("Unable to restore your session. Please sign in again.");
        setLoading(false);
      } else void sync(data.session);
    });
    const refresh = () => {
      if (document.visibilityState === "visible")
        supabase.auth.getSession().then(({ data }) => {
          if (alive) void sync(data.session);
        });
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      requestGeneration.current++;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync]);
  const logout = async () => {
    const { error: err } = await supabase.auth.signOut();
    if (err) throw err;
    await sync(null);
  };
  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        error,
        logout,
        refreshProfile: () => sync(session),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
