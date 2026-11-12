import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, maxContentWidth, radius, space, type } from '@/theme';

import { Button, IconButton } from './ui';

/** Bottom sheet on phones, centred dialog on wide screens. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  testID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} aria-label="Close" />
          <View
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.xl) }]}
            aria-modal
            testID={testID}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Cross-platform replacement for Alert.alert, which does nothing in a browser. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onCancel} testID="confirm-dialog">
      <Text style={styles.message}>{message}</Text>
      {children}
      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.fill} />
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          disabled={confirmDisabled}
          onPress={onConfirm}
          style={styles.fill}
          testID="confirm-dialog-confirm"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? space.lg : 0,
  },
  sheet: {
    width: '100%',
    maxWidth: maxContentWidth,
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: Platform.OS === 'web' ? radius.lg : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? radius.lg : 0,
    paddingTop: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.xl },
  headerText: { flex: 1, gap: 2 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted },
  body: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  message: { ...type.body, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.md },
});
