import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export type TabName = 'articles' | 'log' | 'tasks';

const TABS: { name: TabName; icon: React.ComponentProps<typeof Feather>['name']; label: string; route: string }[] = [
  { name: 'articles', icon: 'book-open',    label: 'Articles', route: '/(tabs)/'     },
  { name: 'log',      icon: 'edit-3',       label: 'Logs',     route: '/(tabs)/log'  },
  { name: 'tasks',    icon: 'check-square', label: 'Tasks',    route: '/(tabs)/tasks'},
];

export function BottomTabBar({ active }: { active: TabName }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = active === tab.name;
        const color = isActive ? colors.primary : colors.mutedForeground;
        return (
          <Pressable
            key={tab.name}
            style={styles.tab}
            onPress={() => {
              if (!isActive) router.replace(tab.route as never);
            }}
            hitSlop={4}
          >
            <Feather name={tab.icon} size={22} color={color} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
});
