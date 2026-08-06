import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';

export default function Index() {
  const { serverUrl, user } = useApp();

  if (!serverUrl) {
    return <Redirect href="/setup" />;
  }
  if (!user) {
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)/" />;
}
