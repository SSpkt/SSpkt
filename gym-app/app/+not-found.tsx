import { Link } from 'expo-router';

import { authStyles } from '@/components/AuthScaffold';
import { EmptyState, Screen } from '@/components/ui';

export default function NotFound() {
  return (
    <Screen scroll={false} testID="not-found">
      <EmptyState icon="compass-outline" title="Page not found" message="That screen doesn't exist.">
        <Link href="/" style={authStyles.link}>
          Go home
        </Link>
      </EmptyState>
    </Screen>
  );
}
