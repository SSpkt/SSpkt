import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, maxContentWidth, minTouchTarget, radius, space, type } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  scroll = true,
  refreshControl,
  footer,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  footer?: ReactNode;
  testID?: string;
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}>
      <View style={styles.column}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.column, styles.fill, styles.staticContent]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.screen} testID={testID}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? <View style={[styles.column, styles.footer]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function LoadingScreen() {
  return (
    <View style={styles.loading} testID="loading-screen">
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  compact = false,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const foreground =
    variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text;

  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={inactive}
      aria-busy={loading}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'primary' && { backgroundColor: pressed ? colors.accentPressed : colors.accent },
        variant === 'secondary' && {
          backgroundColor: pressed ? colors.border : colors.surfaceRaised,
          borderColor: colors.border,
          borderWidth: 1,
        },
        variant === 'ghost' && { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
        variant === 'danger' && { backgroundColor: pressed ? 'rgba(255, 107, 107, 0.2)' : colors.dangerSoft },
        inactive && styles.buttonInactive,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={foreground} /> : null}
          <Text style={[compact ? styles.buttonLabelCompact : styles.buttonLabel, { color: foreground }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color = colors.text,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      hitSlop={6}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.border }]}>
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  hint,
  secure = false,
  multiline = false,
  maxLength,
  showCount = false,
  value,
  ...inputProps
}: TextInputProps & {
  label: string;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  showCount?: boolean;
  value: string;
}) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {showCount && maxLength ? (
          <Text style={styles.fieldCount}>
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.inputWrap,
          multiline && styles.inputWrapMultiline,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
        ]}>
        <TextInput
          aria-label={label}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          {...inputProps}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          secureTextEntry={secure && !revealed}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          style={[styles.input, multiline && styles.inputMultiline, webNoOutline]}
        />
        {secure ? (
          <Pressable
            role="button"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setRevealed((current) => !current)}
            style={styles.reveal}>
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.fieldError} aria-live="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type BannerTone = 'error' | 'success' | 'info';

export function Banner({
  tone = 'error',
  message,
  actionLabel,
  onAction,
  testID,
}: {
  tone?: BannerTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const palette = {
    error: { fg: colors.danger, bg: colors.dangerSoft, icon: 'alert-circle' as IconName },
    success: { fg: colors.success, bg: colors.successSoft, icon: 'checkmark-circle' as IconName },
    info: { fg: colors.accent, bg: colors.accentSoft, icon: 'information-circle' as IconName },
  }[tone];

  return (
    <View
      style={[styles.banner, { backgroundColor: palette.bg }]}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live="polite"
      testID={testID}>
      <Ionicons name={palette.icon} size={18} color={palette.fg} style={styles.bannerIcon} />
      <Text style={[styles.bannerText, { color: palette.fg }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable role="button" onPress={onAction} hitSlop={8} testID={testID ? `${testID}-action` : undefined}>
          <Text style={[styles.bannerAction, { color: palette.fg }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  children,
  testID,
}: {
  icon: IconName;
  title: string;
  message: string;
  children?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.empty} testID={testID}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {children}
    </View>
  );
}

export function Avatar({ label, size = 44 }: { label: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View
      style={styles.progressTrack}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}>
      <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
  busy = false,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      role="checkbox"
      aria-label={label}
      aria-checked={checked}
      aria-busy={busy}
      disabled={busy}
      hitSlop={10}
      onPress={onToggle}
      testID={testID}
      style={({ pressed }) => [styles.checkbox, checked && styles.checkboxChecked, pressed && { opacity: 0.7 }]}>
      {checked ? <Ionicons name="checkmark" size={18} color={colors.onAccent} /> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon: IconName }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmented} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              role="radio"
              aria-label={option.label}
              aria-checked={selected}
              onPress={() => onChange(option.value)}
              testID={`segment-${option.value}`}
              style={[styles.segment, selected && styles.segmentSelected]}>
              <Ionicons name={option.icon} size={18} color={selected ? colors.onAccent : colors.textMuted} />
              <Text style={[styles.segmentLabel, selected && { color: colors.onAccent }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SectionTitle({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.overline}>{children.toUpperCase()}</Text>
      {trailing}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'success' }) {
  const fg = tone === 'accent' ? colors.accent : tone === 'success' ? colors.success : colors.textMuted;
  const bg = tone === 'accent' ? colors.accentSoft : tone === 'success' ? colors.successSoft : colors.surfaceRaised;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

// react-native-web draws a browser focus ring inside our own focus border without this.
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scrollContent: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl },
  staticContent: { paddingHorizontal: space.xl, paddingTop: space.lg },
  column: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  footer: { paddingHorizontal: space.xl, paddingVertical: space.md },

  button: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: minTouchTarget, paddingHorizontal: space.lg, borderRadius: radius.sm },
  buttonInactive: { opacity: 0.5 },
  buttonLabel: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1 },
  buttonLabelCompact: { fontSize: 14, fontWeight: '700' },
  iconButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },

  field: { gap: space.sm },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  fieldLabel: { ...type.label, color: colors.textMuted },
  fieldCount: { ...type.caption, color: colors.textFaint },
  fieldHint: { ...type.caption, color: colors.textFaint },
  fieldError: { ...type.caption, color: colors.danger },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputWrapMultiline: { alignItems: 'flex-start' },
  inputFocused: { borderColor: colors.accent },
  inputError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingHorizontal: space.lg, paddingVertical: space.md },
  inputMultiline: { minHeight: 132, textAlignVertical: 'top' },
  reveal: { paddingHorizontal: space.lg, height: 52, justifyContent: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md },
  bannerIcon: { marginTop: 1 },
  bannerText: { ...type.label, flex: 1, fontWeight: '500' },
  bannerAction: { ...type.label, textDecorationLine: 'underline' },

  empty: { alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  emptyMessage: { ...type.body, color: colors.textMuted, textAlign: 'center', marginBottom: space.sm },

  avatar: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accent, fontWeight: '700' },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },

  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },

  segmented: {
    flexDirection: 'row',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  segmentSelected: { backgroundColor: colors.accent },
  segmentLabel: { ...type.label, color: colors.textMuted },

  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    marginBottom: space.md,
  },
  overline: { ...type.overline, color: colors.textFaint },

  badge: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { ...type.caption, fontWeight: '700' },
});
