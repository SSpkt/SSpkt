import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '@/theme';

import { IconButton } from './ui';

export function Header({
  title,
  subtitle,
  back = false,
  showAccount = false,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  showAccount?: boolean;
}) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      {back ? (
        <IconButton
          icon="chevron-back"
          label="Back"
          testID="back-button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : null}
      <View style={styles.text}>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        <Text style={styles.title} role="heading" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {showAccount ? (
        <IconButton icon="person-outline" label="Account" testID="account-button" onPress={() => router.push('/account')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  text: { flex: 1 },
  subtitle: { ...type.label, color: colors.textMuted },
  title: { ...type.display, color: colors.text },
});
