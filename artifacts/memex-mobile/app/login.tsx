import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function Login() {
  const colors = useColors();
  const { login, serverUrl, setServerUrl } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/');
    } catch (e: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeServer = async () => {
    await setServerUrl('');
    router.replace('/setup');
  };

  const s = styles(colors, insets);

  return (
    <KeyboardAwareScrollViewCompat
      style={s.root}
      contentContainerStyle={s.inner}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      {/* Logo */}
      <View style={s.logoRow}>
        <View style={s.logoBox}>
          <Text style={s.logoLetter}>M</Text>
        </View>
      </View>

      <Text style={s.heading}>Sign in</Text>
      {serverUrl ? (
        <Text style={s.serverLabel} numberOfLines={1}>
          {serverUrl.replace(/^https?:\/\//, '')}
        </Text>
      ) : null}

      {/* Fields */}
      <View style={s.fields}>
        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={(t) => { setEmail(t); setError(null); }}
          placeholder="you@example.com"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
          textContentType="emailAddress"
        />

        <Text style={[s.label, { marginTop: 14 }]}>Password</Text>
        <View style={s.passwordRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={password}
            onChangeText={(t) => { setPassword(t); setError(null); }}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry={!showPassword}
            returnKeyType="go"
            textContentType="password"
            onSubmitEditing={handleLogin}
          />
          <Pressable style={s.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {error && (
          <View style={s.errorRow}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={s.errorText}>  {error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [s.btn, pressed && { opacity: 0.82 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.btnText}>Sign in</Text>}
        </Pressable>
      </View>

      <Pressable style={s.changeServer} onPress={handleChangeServer}>
        <Feather name="server" size={13} color={colors.mutedForeground} />
        <Text style={s.changeServerText}>  Change server</Text>
      </Pressable>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = (c: ReturnType<typeof useColors>, insets: ReturnType<typeof useSafeAreaInsets>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    inner: {
      paddingHorizontal: 28,
      paddingTop: insets.top + 50,
      paddingBottom: insets.bottom + 20,
      flexGrow: 1,
    },
    logoRow: { alignItems: 'center', marginBottom: 24 },
    logoBox: {
      width: 64,
      height: 64,
      borderRadius: 16,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoLetter: { fontSize: 36, fontWeight: '700' as const, color: '#fff', fontFamily: 'Inter_700Bold' },
    heading: {
      fontSize: 24,
      fontWeight: '700' as const,
      fontFamily: 'Inter_700Bold',
      color: c.foreground,
      textAlign: 'center',
      marginBottom: 4,
    },
    serverLabel: {
      fontSize: 13,
      color: c.mutedForeground,
      fontFamily: 'Inter_400Regular',
      textAlign: 'center',
      marginBottom: 28,
    },
    fields: { gap: 0 },
    label: {
      fontSize: 13,
      fontWeight: '600' as const,
      fontFamily: 'Inter_600SemiBold',
      color: c.foreground,
      marginBottom: 6,
    },
    input: {
      height: 50,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: c.radius,
      paddingHorizontal: 14,
      fontSize: 15,
      fontFamily: 'Inter_400Regular',
      color: c.foreground,
      backgroundColor: c.card,
      marginBottom: 0,
    },
    passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    eyeBtn: { padding: 12 },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
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
      marginTop: 20,
    },
    btnText: { fontSize: 16, fontWeight: '600' as const, fontFamily: 'Inter_600SemiBold', color: '#fff' },
    changeServer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 32,
      padding: 8,
    },
    changeServerText: { fontSize: 13, color: c.mutedForeground, fontFamily: 'Inter_400Regular' },
  });
