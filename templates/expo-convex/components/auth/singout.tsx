import { COLORS } from '@/theme/colors';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';
import { useRouter } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import { Text, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export const SignOutButton = () => {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const handleSignOut = async () => {
    if (Platform.OS !== 'web')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await signOut();
      router.dismissAll();
    } catch (error) {
      console.error('Sign out error:', error);
      router.dismissAll();
    }
  };

  return isAuthenticated ? (
    <TouchableOpacity
      onPress={handleSignOut}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        backgroundColor: COLORS.red,
        borderRadius: 100,
        shadowColor: COLORS.red,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
      }}
    >
      <LogOut color={COLORS.white} size={18} strokeWidth={2.5} />
      <Text
        style={{
          color: COLORS.white,
          fontSize: 16,
          fontWeight: '800',
          letterSpacing: 0.3,
        }}
      >
        Sign Out
      </Text>
    </TouchableOpacity>
  ) : null;
};
