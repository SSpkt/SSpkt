import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/theme';

export const APP_NAME = 'TrainerOps';

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <View style={styles.row} role="heading" aria-label={APP_NAME}>
      <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.3 }]}>
        <Ionicons name="barbell" size={size * 0.56} color={colors.onAccent} />
      </View>
      <Text style={[styles.word, { fontSize: size * 0.46 }]}>
        Trainer<Text style={styles.wordAccent}>Ops</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  word: { color: colors.text, fontWeight: '800', letterSpacing: -0.8 },
  wordAccent: { color: colors.accent },
});
