import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

/** Dark splash shown while the session is restored; the root layout then routes by role. */
export default function Splash() {
  return (
    <View style={styles.container} testID="splash">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
