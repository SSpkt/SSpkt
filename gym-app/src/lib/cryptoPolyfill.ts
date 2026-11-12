import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';

type MinimalCrypto = {
  getRandomValues?: typeof ExpoCrypto.getRandomValues;
  subtle?: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
};

/**
 * React Native has no WebCrypto. Without it supabase-js builds its PKCE verifier from
 * Math.random and sends an unhashed challenge, so native gets the OS CSPRNG and SHA-256
 * from expo-crypto instead. Browsers already have the real thing and are left alone.
 */
export function installCryptoPolyfill(): void {
  if (Platform.OS === 'web') return;
  const scope = globalThis as unknown as { crypto?: MinimalCrypto };
  const target: MinimalCrypto = scope.crypto ?? {};
  if (!scope.crypto) scope.crypto = target;

  if (typeof target.getRandomValues !== 'function') {
    target.getRandomValues = ExpoCrypto.getRandomValues;
  }
  if (!target.subtle) {
    target.subtle = {
      digest(algorithm, data) {
        if (algorithm !== 'SHA-256') return Promise.reject(new Error(`Unsupported digest: ${algorithm}`));
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      },
    };
  }
}
