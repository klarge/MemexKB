import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';

// The system browser's listener handles live callbacks with the in-memory
// verifier. Cold-start/stale links cannot authenticate without that verifier.
export default function SsoCallback() {
  const { user } = useApp();
  return <Redirect href={user ? '/(tabs)' : '/login'} />;
}
