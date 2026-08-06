import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function Setup() {
  const colors = useColors();
  const { setServerUrl, testConnection } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [url, setUrl] = useState('http://');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleConnect = async () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed === 'http://' || trimmed === 'https://') {
      setError('Enter the address of your Memex server.');
      return;
    }
    setError(null);
    setTesting(true);
    setSuccess(false);
    try {
      const ok = await testConnection(trimmed);
      if (!ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError('Could not reach the server. Check the address and make sure Memex is running.');
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(true);
      await setServerUrl(trimmed);
      setTimeout(() => router.replace('/login'), 300);
    } catch {
      setError('Connection failed. Check your network and server address.');
    } finally {
      setTesting(false);
    }
  };

  const s = styles(colors, insets);

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.inner}>
        {/* Logo area */}
        <View style={s.logoRow}>
          <View style={s.logoBox}>
            <Text style={s.logoLetter}>M</Text>
          </View>
        </View>

        <Text style={s.heading}>Connect to Memex</Text>
        <Text style={s.sub}>
          Enter the address of your self-hosted Memex instance.
        </Text>

        <View style={s.exampleRow}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={s.example}>  e.g. http://192.168.1.10:8080</Text>
        </View>

        <TextInput
          style={[s.input, error ? s.inputError : null]}
          value={url}
          onChangeText={(t) => { setUrl(t); setError(null); }}
          placeholder="http://192.168.1.x:8080"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />

        {error && (
          <View style={s.errorRow}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={s.errorText}>  {error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [s.btn, pressed && { opacity: 0.82 }]}
          onPress={handleConnect}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={s.btnText}>{success ? 'Connected!' : 'Connect'}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    inner: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: insets.top + 60,
      paddingBottom: insets.bottom + 20,
    },
    logoRow: { alignItems: 'center', marginBottom: 28 },
    logoBox: {
      width: 72,
      height: 72,
      borderRadius: 18,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoLetter: {
      fontSize: 40,
      fontWeight: '700' as const,
      color: '#fff',
      fontFamily: 'Inter_700Bold',
    },
    heading: {
      fontSize: 26,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: c.foreground,
      textAlign: 'center',
      marginBottom: 8,
    },
    sub: {
      fontSize: 15,
      color: c.mutedForeground,
      fontFamily: 'Inter_400Regular',
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 20,
    },
    exampleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
      justifyContent: 'center',
    },
    example: {
      fontSize: 13,
      color: c.mutedForeground,
      fontFamily: 'Inter_400Regular',
    },
    input: {
      height: 52,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: c.radius,
      paddingHorizontal: 16,
      fontSize: 16,
      fontFamily: 'Inter_400Regular',
      color: c.foreground,
      backgroundColor: c.card,
      marginBottom: 12,
    },
    inputError: { borderColor: c.destructive },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
    errorText: {
      fontSize: 13,
      color: c.destructive,
      fontFamily: 'Inter_400Regular',
      flex: 1,
      lineHeight: 18,
    },
    btn: {
      height: 52,
      backgroundColor: c.primary,
      borderRadius: c.radius,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: {
      fontSize: 16,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
      color: '#fff',
    },
  });
