import { Alert, Platform } from 'react-native';

export function confirmLocalRemoval(title: string, message: string, action: () => Promise<void>, failed: (message: string) => void) {
  const run = () => { void action().catch(error => failed(error instanceof Error ? error.message : 'Unable to remove the local download.')); };
  if (Platform.OS === 'web') {
    if (globalThis.confirm(`${title}\n\n${message}`)) run();
  } else Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: run },
  ]);
}
