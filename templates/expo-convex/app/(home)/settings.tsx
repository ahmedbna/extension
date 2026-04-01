import { SignOutButton } from '@/components/auth/singout';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/convex/_generated/api';
import { COLORS } from '@/theme/colors';
import { useQuery } from 'convex/react';
import { Text, View } from 'react-native';

export default function SettingsScreen() {
  const user = useQuery(api.auth.loggedInUser);

  if (user === undefined) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: COLORS.yellow,
        }}
      >
        <Spinner color={COLORS.black} />
      </View>
    );
  }

  if (user === null) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: COLORS.yellow,
        }}
      >
        <Text
          style={{
            color: COLORS.black,
            fontSize: 15,
            fontWeight: '700',
          }}
        >
          Not Authenticated
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.yellow,
        paddingHorizontal: 20,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      {/* User Info Card */}
      <View
        style={{
          width: '100%',
          backgroundColor: COLORS.black,
          borderRadius: 24,
          padding: 24,
          gap: 16,
          shadowColor: COLORS.black,
          shadowOffset: { width: 0, height: 16 },
          shadowOpacity: 0.4,
          shadowRadius: 32,
          elevation: 16,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            color: COLORS.inputLabel,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
          }}
        >
          YOUR CONVEX User ID
        </Text>

        <View
          style={{
            backgroundColor: COLORS.inputBg,
            borderRadius: 100,
            borderWidth: 1.5,
            borderColor: COLORS.inputBorder,
            paddingHorizontal: 22,
            paddingVertical: 14,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: COLORS.white,
              fontWeight: '500',
            }}
            numberOfLines={1}
            ellipsizeMode='middle'
          >
            {user._id}
          </Text>
        </View>

        {/* Divider */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <View
            style={{ flex: 1, height: 1, backgroundColor: COLORS.divider }}
          />
          <Text
            style={{
              fontSize: 12,
              color: COLORS.dividerLabel,
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            actions
          </Text>
          <View
            style={{ flex: 1, height: 1, backgroundColor: COLORS.divider }}
          />
        </View>

        <SignOutButton />
      </View>
    </View>
  );
}
