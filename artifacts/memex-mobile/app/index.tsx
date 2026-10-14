import { Redirect } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { serverUrl, user, isHydrating } = useApp();
  if (isHydrating) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;

  if (!serverUrl) {
    return <Redirect href="/setup" />;
  }
  if (!user) {
    return <Redirect href="/login" />;
  }
  return <Redirect href="/(tabs)" />;
}
