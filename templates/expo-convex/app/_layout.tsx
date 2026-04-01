import { Authentication } from '@/components/auth/authentication';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
} from 'convex/react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Spinner } from '@/components/ui/spinner';
import { COLORS } from '@/theme/colors';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import 'react-native-reanimated';

SplashScreen.setOptions({
  duration: 200,
  fade: true,
});

const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

export const unstable_settings = {
  anchor: '(home)',
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ConvexAuthProvider client={convex} storage={secureStorage}>
          <AuthLoading>
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: COLORS.yellow,
              }}
            >
              <Spinner color={COLORS.black} />
            </View>
          </AuthLoading>
          <Unauthenticated>
            <Authentication />
          </Unauthenticated>
          <Authenticated>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name='(home)' options={{ headerShown: false }} />
              <Stack.Screen name='+not-found' />
            </Stack>
          </Authenticated>
        </ConvexAuthProvider>
      </KeyboardProvider>
      <StatusBar style='auto' />
    </GestureHandlerRootView>
  );
}
