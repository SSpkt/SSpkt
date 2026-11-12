import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '@/theme';

import { Logo } from './Logo';
import { Screen } from './ui';

export function AuthScaffold({
  title,
  subtitle,
  children,
  testID,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Screen testID={testID}>
      <View style={styles.container}>
        <Logo />
        <View style={styles.heading}>
          <Text style={styles.title} role="heading">
            {title}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.form}>{children}</View>
      </View>
    </Screen>
  );
}

export const authStyles = StyleSheet.create({
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  linkText: { ...type.body, color: colors.textMuted },
  link: { ...type.body, color: colors.accent, fontWeight: '600', paddingVertical: space.sm },
  legal: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: space.xxl, paddingVertical: space.xxl },
  heading: { gap: space.sm },
  title: { ...type.display, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted },
  form: { gap: space.lg },
});
